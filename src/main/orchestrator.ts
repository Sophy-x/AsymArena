import { randomInt, randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type {
  CreateMatchInput,
  EloChange,
  GameSnapshot,
  MatchSummary,
  ModelProfile,
  PrivateObservation,
  RatingEntry,
  ReplayData,
  SeatConfig,
} from '@shared/types'
import { createGameMcpLink } from './mcp/link'
import type { GameModule } from './games/contracts'
import { GameRegistry } from './games/registry'
import type { ChatMessage, MatchDocument } from './store'
import { ArenaStore } from './store'
import { OpenAICompatibleProvider } from './providers/openai-compatible'
import { getRatingExclusionReason } from './ratings/eligibility'
import { trimConversationHistory } from './conversation'

type UpdateListener = (snapshot: GameSnapshot) => void

export class MatchOrchestrator {
  private readonly registry = new GameRegistry()
  private readonly store = new ArenaStore()
  private readonly provider = new OpenAICompatibleProvider()
  private readonly waiters = new Map<string, () => void>()
  private readonly listeners = new Set<UpdateListener>()
  private readonly running = new Set<string>()

  async bootstrap(): Promise<{
    games: ReturnType<GameRegistry['all']>[number]['descriptor'][]
    profiles: Awaited<ReturnType<ArenaStore['publicProfiles']>>
    matches: MatchSummary[]
    ratings: RatingEntry[]
  }> {
    const [profiles, matches, ratings] = await Promise.all([this.store.publicProfiles(), this.store.matches(), this.store.ratings()])
    return {
      games: this.registry.all().map((game) => game.descriptor),
      profiles,
      matches: matches.map((match) => this.store.toSummary(match, this.snapshot(match))),
      ratings,
    }
  }

  onUpdate(listener: UpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async saveProfile(profile: ModelProfile) {
    await this.store.saveProfile(profile)
    return this.store.publicProfiles()
  }

  async deleteProfile(profileId: string) {
    await this.store.deleteProfile(profileId)
    return this.store.publicProfiles()
  }

  async testProfile(profile: ModelProfile): Promise<string> {
    return this.provider.testConnection(await this.withSavedCredential(profile))
  }

  async listModels(profile: ModelProfile): Promise<string[]> {
    return this.provider.listModels(await this.withSavedCredential(profile))
  }

  async createMatch(input: CreateMatchInput): Promise<GameSnapshot> {
    const game = this.registry.get(input.gameId)
    const profiles = await this.store.profiles()
    const profileIds = new Set(profiles.map((profile) => profile.id))
    let seats: SeatConfig[]
    let ratingMode: MatchDocument['ratingMode']
    let randomProfileIds: string[] | undefined
    if (input.lineup.mode === 'manual') {
      seats = input.lineup.seats
      ratingMode = 'manual'
    } else {
      const selectedProfiles = [...new Set(input.lineup.profileIds)]
      if (selectedProfiles.length !== input.lineup.profileIds.length || selectedProfiles.length < 2) {
        throw new Error('随机 Elo 阵容至少选择两个不同模型，且不能重复选择')
      }
      if (
        !Number.isInteger(input.lineup.seatCount) ||
        input.lineup.seatCount < game.descriptor.minSeats ||
        input.lineup.seatCount > game.descriptor.maxSeats
      ) {
        throw new Error(`座位数必须在 ${game.descriptor.minSeats}–${game.descriptor.maxSeats} 之间`)
      }
      for (const profileId of selectedProfiles) {
        if (!profileIds.has(profileId)) throw new Error('随机模型池包含不存在的模型档案')
      }
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
      randomProfileIds = selectedProfiles
      ratingMode = 'random-models'
      seats = Array.from({ length: input.lineup.seatCount }, (_, index) => {
        const profile = profileById.get(selectedProfiles[randomInt(selectedProfiles.length)])!
        return {
          id: randomUUID(),
          kind: 'model' as const,
          profileId: profile.id,
          name: `${profile.name} #${index + 1}`,
        }
      })
    }
    game.validateSeats(seats)
    for (const seat of seats) {
      if (seat.kind === 'model' && !profileIds.has(seat.profileId)) {
        throw new Error(`模型档案不存在：${seat.name}`)
      }
    }
    const gameState = game.create(input.config, seats)
    const id = game.publicState(gameState).matchId
    const ratingReason = getRatingExclusionReason({
      gameId: input.gameId,
      mode: ratingMode,
      seatCount: seats.length,
      undercoverCount: Number(input.config.undercoverCount ?? 1),
      modelProfileIds: seats.filter((seat) => seat.kind === 'model').map((seat) => seat.profileId),
      humanSeats: seats.filter((seat) => seat.kind === 'human').length,
    })
    const document: MatchDocument = {
      id,
      gameId: input.gameId,
      gameState,
      seats,
      ratingEligible: !ratingReason,
      ratingReason,
      ratingMode,
      randomProfileIds,
      createdAt: new Date().toISOString(),
      contextBySeat: {},
      ratingChanges: [],
      ratingApplied: false,
      runStatus: 'setup',
    }
    await this.store.createMatch(document)
    return this.snapshot(document)
  }

  async getMatch(matchId: string): Promise<GameSnapshot> {
    return this.snapshot(await this.store.match(matchId))
  }

  async listMatches(): Promise<MatchSummary[]> {
    const matches = await this.store.matches()
    return matches.map((match) => this.store.toSummary(match, this.snapshot(match)))
  }

  async deleteMatch(matchId: string): Promise<void> {
    if (this.running.has(matchId)) throw new Error('进行中的对局不能删除')
    const matches = await this.store.matches()
    const results = new Map<string, NonNullable<ReturnType<GameModule['result']>>>()
    for (const match of matches) {
      if (match.id === matchId || match.runStatus !== 'finished' || !match.ratingEligible) continue
      const result = this.registry.get(match.gameId).result(match.gameState)
      if (result) results.set(match.id, result)
    }
    await this.store.deleteMatch(matchId, results)
  }

  async getRatings(gameId?: string): Promise<RatingEntry[]> {
    return this.store.ratings(gameId)
  }

  async startMatch(matchId: string): Promise<GameSnapshot> {
    const document = await this.store.match(matchId)
    if (document.runStatus !== 'setup') throw new Error('Only a new match can be started')
    const game = this.registry.get(document.gameId)
    document.gameState = game.start(document.gameState)
    document.runStatus = 'running'
    await this.store.saveMatch(document)
    this.publish(document)
    void this.run(document.id)
    return this.snapshot(document)
  }

  async getHumanObservation(matchId: string, seatId: string): Promise<PrivateObservation> {
    const document = await this.store.match(matchId)
    const seat = document.seats.find((candidate) => candidate.id === seatId)
    if (!seat || seat.kind !== 'human') throw new Error('This seat is not a human seat')
    const game = this.registry.get(document.gameId)
    if (game.currentSeatId(document.gameState) !== seatId || !game.isWaitingForHuman(document.gameState)) {
      throw new Error('It is not this human seat’s turn')
    }
    const observation = game.observation(document.gameState, seatId)
    await this.store.saveMatch(document)
    return observation
  }

  async submitHumanAction(matchId: string, seatId: string, tool: string, args: Record<string, unknown>): Promise<GameSnapshot> {
    const document = await this.store.match(matchId)
    const seat = document.seats.find((candidate) => candidate.id === seatId)
    if (!seat || seat.kind !== 'human') throw new Error('This seat is not a human seat')
    const game = this.registry.get(document.gameId)
    const { state } = game.invoke(document.gameState, seatId, tool, args)
    document.gameState = state
    document.runStatus = 'running'
    await this.store.saveMatch(document)
    this.publish(document)
    this.waiters.get(matchId)?.()
    return this.snapshot(document)
  }

  async retryMatch(matchId: string): Promise<GameSnapshot> {
    const document = await this.store.match(matchId)
    if (document.runStatus !== 'paused') throw new Error('This match is not paused')
    document.runStatus = 'running'
    document.error = undefined
    await this.store.saveMatch(document)
    this.publish(document)
    void this.run(matchId)
    return this.snapshot(document)
  }

  async getReplay(matchId: string): Promise<ReplayData> {
    const document = await this.store.match(matchId)
    const game = this.registry.get(document.gameId)
    if (!game.isFinished(document.gameState)) throw new Error('Replay is available after the match finishes')
    const result = game.result(document.gameState)
    if (!result) throw new Error('Final game result is missing')
    return {
      snapshot: this.snapshot(document),
      privateObservations: game.replayObservations(document.gameState),
      roles: result.roles,
      ratingChanges: document.ratingChanges,
    }
  }

  private async run(matchId: string): Promise<void> {
    if (this.running.has(matchId)) return
    this.running.add(matchId)
    try {
      while (true) {
        const document = await this.store.match(matchId)
        if (document.runStatus !== 'running') return
        const game = this.registry.get(document.gameId)
        if (game.isFinished(document.gameState)) {
          await this.complete(document, game)
          return
        }
        if (game.needsAdvance(document.gameState)) {
          document.gameState = game.next(document.gameState)
          await this.store.saveMatch(document)
          this.publish(document)
          continue
        }

        const seatId = game.currentSeatId(document.gameState)
        const seat = document.seats.find((candidate) => candidate.id === seatId)
        if (!seatId || !seat) throw new Error('Game module returned an unknown current seat')
        if (seat.kind === 'human') {
          document.runStatus = 'waiting-human'
          await this.store.saveMatch(document)
          this.publish(document)
          await new Promise<void>((resolve) => this.waiters.set(matchId, resolve))
          this.waiters.delete(matchId)
          continue
        }

        await this.runModelTurn(document, game, seatId, seat.profileId)
      }
    } catch (error) {
      const document = await this.store.match(matchId)
      document.runStatus = 'paused'
      document.error = error instanceof Error ? error.message : String(error)
      this.addControllerError(document)
      await this.store.saveMatch(document)
      this.publish(document)
    } finally {
      this.running.delete(matchId)
    }
  }

  private async runModelTurn(document: MatchDocument, game: GameModule, seatId: string, profileId: string): Promise<void> {
    const profile = (await this.store.profiles()).find((entry) => entry.id === profileId)
    if (!profile) throw new Error(`Model profile not found: ${profileId}`)
    const messages = document.contextBySeat[seatId] ?? [
      {
        role: 'system' as const,
        content: `${game.agentInstructions(document.gameState, seatId)} Use the provided MCP tools to observe and act. Your context is private to this seat. Do not claim an action succeeded until a tool confirms it.`,
      },
    ]
    trimConversationHistory(messages)
    messages.push({
      role: 'user',
      content: `Round ${game.round(document.gameState)}. Phase: ${game.phaseLabel(document.gameState)}. Use the game MCP tools to inspect your permitted context and submit exactly one legal action.`,
    })
    document.contextBySeat[seatId] = messages
    const link = await createGameMcpLink(
      game,
      seatId,
      () => document.gameState,
      async (state) => {
        document.gameState = state
        await this.store.saveMatch(document)
        this.publish(document)
      },
    )
    try {
      await this.provider.takeTurn(profile, messages, link)
      trimConversationHistory(messages)
      await this.store.saveMatch(document)
    } finally {
      await link.close()
    }
  }

  private async complete(document: MatchDocument, game: GameModule): Promise<void> {
    const result = game.result(document.gameState)
    if (result && !document.ratingApplied) {
      if (document.ratingEligible) {
        document.ratingChanges = await this.store.applyTeamElo(document, result, game.descriptor.name)
      } else {
        document.ratingApplied = true
        document.ratingChanges = []
      }
    }
    document.runStatus = 'finished'
    document.error = undefined
    await this.store.saveMatch(document)
    this.publish(document)
  }

  private async withSavedCredential(profile: ModelProfile): Promise<ModelProfile> {
    if (profile.apiKey.trim()) return profile
    const saved = (await this.store.profiles()).find((entry) => entry.id === profile.id)
    if (!saved) throw new Error('请先填写 API Key')
    return { ...profile, apiKey: saved.apiKey }
  }

  private addControllerError(document: MatchDocument): void {
    const game = this.registry.get(document.gameId)
    const events = game.events(document.gameState)
    events.push({
      id: randomUUID(),
      time: new Date().toISOString(),
      round: game.round(document.gameState),
      kind: 'error',
      text: document.error ?? 'Match controller error',
    })
    const state = document.gameState as Record<string, unknown>
    state.events = events
    document.gameState = state
  }

  private snapshot(document: MatchDocument): GameSnapshot {
    const game = this.registry.get(document.gameId)
    return {
      ...game.publicState(document.gameState),
      status: document.runStatus,
      error: document.error,
      eloChanges: document.ratingChanges,
      ratingStatus: document.ratingEligible ? (document.ratingApplied ? 'counted' : 'pending') : 'excluded',
      ratingReason: document.ratingReason,
    }
  }

  private publish(document: MatchDocument): void {
    const snapshot = this.snapshot(document)
    for (const listener of this.listeners) listener(snapshot)
  }
}

export function createUpdateEmitter(window: BrowserWindow) {
  return (snapshot: GameSnapshot): void => {
    if (!window.isDestroyed()) window.webContents.send('arena:match-updated', snapshot)
  }
}
