import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EloChange, GameSnapshot, MatchSummary, ModelProfile, ModelThought, RatingEntry, ReplayData, SeatConfig } from '@shared/types'
import type { GameResult } from './games/contracts'
import { calculateTeamElo, modelSeatsForResult } from './ratings/team-elo'
import { countStartedModelSeatParticipations, recordStartedMatchParticipation } from './participation'

export interface MatchDocument {
  id: string
  gameId: string
  gameState: unknown
  seats: SeatConfig[]
  participationCounted: boolean
  ratingEligible: boolean
  ratingReason?: string
  ratingMode: 'manual' | 'random-models'
  randomProfileIds?: string[]
  createdAt: string
  contextBySeat: Record<string, ChatMessage[]>
  modelThoughts?: ModelThought[]
  ratingChanges: EloChange[]
  ratingApplied: boolean
  ratingAppliedAt?: string
  runStatus: 'setup' | 'running' | 'waiting-human' | 'paused' | 'finished'
  error?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface StoreFile {
  ratingSchemeVersion: number
  participationSchemeVersion: number
  profiles: Array<Omit<ModelProfile, 'apiKey'> & { encryptedApiKey: string }>
  matches: MatchDocument[]
  ratings: RatingEntry[]
  modelParticipationCounts: Record<string, number>
}

export class ArenaStore {
  private readonly filePath: string
  private data: StoreFile = {
    ratingSchemeVersion: 2,
    participationSchemeVersion: 2,
    profiles: [],
    matches: [],
    ratings: [],
    modelParticipationCounts: {},
  }
  private ready: Promise<void>
  private writeQueue: Promise<void> = Promise.resolve()

  constructor() {
    this.filePath = join(app.getPath('userData'), 'arena.json')
    this.ready = this.load()
  }

  private async load(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoreFile>
      const canReuseParticipationCounts =
        parsed.participationSchemeVersion === 2 && parsed.modelParticipationCounts !== undefined
      const matches = (parsed.matches ?? []).map((match) => ({
        ...match,
        participationCounted:
          match.ratingMode === 'random-models' && match.runStatus !== 'setup'
            ? canReuseParticipationCounts
              ? (match.participationCounted ?? true)
              : true
            : false,
      }))
      this.data = {
        ratingSchemeVersion: parsed.ratingSchemeVersion ?? 0,
        participationSchemeVersion: parsed.participationSchemeVersion ?? 0,
        profiles: parsed.profiles ?? [],
        matches,
        ratings: parsed.ratings ?? [],
        modelParticipationCounts: canReuseParticipationCounts
          ? parsed.modelParticipationCounts!
          : countStartedModelSeatParticipations(matches),
      }
      let needsFlush = parsed.participationSchemeVersion !== 2 || parsed.modelParticipationCounts === undefined
      this.data.participationSchemeVersion = 2
      if (this.data.ratingSchemeVersion < 2) {
        this.data.ratings = []
        this.data.matches = this.data.matches.map((match) => {
          if (match.ratingMode) return match
          return {
            ...match,
            ratingEligible: false,
            ratingReason: '旧版本对局未记录随机模型阵容，不能计入新 Elo 榜。',
            ratingMode: 'manual',
            ratingApplied: match.runStatus === 'finished' || match.ratingApplied,
            ratingChanges: [],
          }
        })
        this.data.ratingSchemeVersion = 2
        needsFlush = true
      }
      if (needsFlush) {
        await this.flush()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.flush()
    }
  }

  private async flush(): Promise<void> {
    const serialized = JSON.stringify(this.data, null, 2)
    const tempPath = `${this.filePath}.tmp`
    this.writeQueue = this.writeQueue.then(async () => {
      await writeFile(tempPath, serialized, 'utf8')
      await rename(tempPath, this.filePath)
    })
    await this.writeQueue
  }

  private async ensureReady(): Promise<void> {
    await this.ready
  }

  async profiles(): Promise<ModelProfile[]> {
    await this.ensureReady()
    return this.data.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: this.decrypt(profile.encryptedApiKey),
    }))
  }

  async publicProfiles(): Promise<Array<Omit<ModelProfile, 'apiKey'> & { hasApiKey: boolean }>> {
    await this.ensureReady()
    return this.data.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      hasApiKey: Boolean(profile.encryptedApiKey),
    }))
  }

  async saveProfile(input: ModelProfile): Promise<void> {
    await this.ensureReady()
    const existing = this.data.profiles.find((profile) => profile.id === input.id)
    const apiKey = input.apiKey.trim() || (existing ? this.decrypt(existing.encryptedApiKey) : '')
    if (!input.name.trim() || !input.baseUrl.trim() || !input.model.trim() || !apiKey) {
      throw new Error('名称、Base URL、Model ID 和 API Key 为必填项')
    }
    if (!/^https?:\/\//i.test(input.baseUrl)) throw new Error('Base URL 必须以 http:// 或 https:// 开头')
    const profile = {
      id: input.id,
      name: input.name.trim(),
      provider: 'openai-compatible' as const,
      baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
      model: input.model.trim(),
      encryptedApiKey: this.encrypt(apiKey),
    }
    this.data.profiles = [...this.data.profiles.filter((entry) => entry.id !== input.id), profile]
    await this.flush()
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.ensureReady()
    this.data.profiles = this.data.profiles.filter((profile) => profile.id !== profileId)
    await this.flush()
  }

  async createMatch(document: MatchDocument): Promise<void> {
    await this.ensureReady()
    this.data.matches = [document, ...this.data.matches]
    await this.flush()
  }

  async match(matchId: string): Promise<MatchDocument> {
    await this.ensureReady()
    const match = this.data.matches.find((entry) => entry.id === matchId)
    if (!match) throw new Error('对局不存在')
    return match
  }

  async matches(): Promise<MatchDocument[]> {
    await this.ensureReady()
    return [...this.data.matches]
  }

  async modelParticipationCounts(): Promise<Record<string, number>> {
    await this.ensureReady()
    return { ...this.data.modelParticipationCounts }
  }

  async deleteMatch(matchId: string, results: Map<string, GameResult>): Promise<void> {
    await this.ensureReady()
    const match = this.data.matches.find((entry) => entry.id === matchId)
    if (!match) throw new Error('对局不存在')
    if (match.runStatus === 'running' || match.runStatus === 'waiting-human') {
      throw new Error('进行中的对局不能删除')
    }
    this.data.matches = this.data.matches.filter((entry) => entry.id !== matchId)
    await this.rebuildRatings(results)
    await this.flush()
  }

  async saveMatch(document: MatchDocument): Promise<void> {
    await this.ensureReady()
    recordStartedMatchParticipation(document, this.data.modelParticipationCounts)
    this.data.matches = this.data.matches.map((entry) => (entry.id === document.id ? document : entry))
    await this.flush()
  }

  async ratings(gameId?: string): Promise<RatingEntry[]> {
    await this.ensureReady()
    return this.data.ratings.filter((entry) => !gameId || entry.gameId === gameId).sort((a, b) => b.rating - a.rating)
  }

  async applyTeamElo(document: MatchDocument, result: GameResult, gameName: string, kFactor = 32): Promise<EloChange[]> {
    await this.ensureReady()
    if (document.ratingApplied) return document.ratingChanges
    if (!document.ratingEligible) {
      document.ratingApplied = true
      document.ratingChanges = []
      await this.saveMatch(document)
      return []
    }
    const profiles = await this.profiles()
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
    const currentRatings = new Map(this.data.ratings.map((entry) => [`${entry.gameId}:${entry.profileId}`, entry]))
    const ratedModels = new Map<string, { rating: number; profileName: string }>()
    for (const [profileId, profile] of profileById) {
      const entry = currentRatings.get(`${document.gameId}:${profileId}`)
      ratedModels.set(profileId, {
        rating: entry?.rating ?? 1000,
        profileName: profile.name,
      })
    }
    const participants = modelSeatsForResult(document.seats, result, ratedModels)
    const teamsWithModels = new Set(participants.map((participant) => participant.team))
    if (teamsWithModels.size !== 2) {
      document.ratingApplied = true
      document.ratingChanges = []
      await this.saveMatch(document)
      return []
    }
    const { changes, profileScores } = calculateTeamElo(participants, result, kFactor)
    for (const change of changes) {
      const key = `${document.gameId}:${change.profileId}`
      const existing = currentRatings.get(key)
      const score = profileScores.get(change.profileId) ?? 0.5
      const entry: RatingEntry = {
        gameId: document.gameId,
        gameName,
        profileId: change.profileId,
        profileName: change.profileName,
        rating: change.after,
        games: (existing?.games ?? 0) + 1,
        wins: (existing?.wins ?? 0) + (score === 1 ? 1 : 0),
        updatedAt: new Date().toISOString(),
      }
      currentRatings.set(key, entry)
    }
    this.data.ratings = [...currentRatings.values()]
    document.ratingApplied = true
    document.ratingAppliedAt = new Date().toISOString()
    document.ratingChanges = changes
    await this.saveMatch(document)
    return changes
  }

  private async rebuildRatings(results: Map<string, GameResult>): Promise<void> {
    const previousRatings = new Map(this.data.ratings.map((entry) => [`${entry.gameId}:${entry.profileId}`, entry]))
    const profiles = await this.publicProfiles()
    const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]))
    const currentRatings = new Map<string, RatingEntry>()
    const ratedMatches = this.data.matches
      .filter((match) => match.runStatus === 'finished' && match.ratingEligible)
      .sort((a, b) => (a.ratingAppliedAt ?? a.createdAt).localeCompare(b.ratingAppliedAt ?? b.createdAt))

    for (const document of ratedMatches) {
      const result = results.get(document.id)
      if (!result) continue
      const ratedModels = new Map<string, { rating: number; profileName: string }>()
      for (const seat of document.seats) {
        if (seat.kind !== 'model' || ratedModels.has(seat.profileId)) continue
        const existing = currentRatings.get(`${document.gameId}:${seat.profileId}`)
        ratedModels.set(seat.profileId, {
          rating: existing?.rating ?? 1000,
          profileName:
            profileNames.get(seat.profileId) ?? previousRatings.get(`${document.gameId}:${seat.profileId}`)?.profileName ?? seat.name,
        })
      }
      const participants = modelSeatsForResult(document.seats, result, ratedModels)
      if (new Set(participants.map((participant) => participant.team)).size !== 2) {
        document.ratingChanges = []
        continue
      }
      const { changes, profileScores } = calculateTeamElo(participants, result)
      for (const change of changes) {
        const key = `${document.gameId}:${change.profileId}`
        const existing = currentRatings.get(key)
        const score = profileScores.get(change.profileId) ?? 0.5
        currentRatings.set(key, {
          gameId: document.gameId,
          gameName: existing?.gameName ?? previousRatings.get(key)?.gameName ?? document.gameId,
          profileId: change.profileId,
          profileName: profileNames.get(change.profileId) ?? previousRatings.get(key)?.profileName ?? change.profileName,
          rating: change.after,
          games: (existing?.games ?? 0) + 1,
          wins: (existing?.wins ?? 0) + (score === 1 ? 1 : 0),
          updatedAt: document.ratingAppliedAt ?? document.createdAt,
        })
      }
      document.ratingChanges = changes
      document.ratingApplied = true
    }
    this.data.ratings = [...currentRatings.values()]
  }

  toSummary(document: MatchDocument, snapshot: GameSnapshot): MatchSummary {
    return {
      matchId: document.id,
      gameId: document.gameId,
      gameName: snapshot.gameName,
      status: document.runStatus,
      phaseLabel: snapshot.phaseLabel,
      round: snapshot.round,
      maxRounds: snapshot.maxRounds,
      seats: document.seats.map(({ id, name, kind }) => ({ id, name, kind })),
      createdAt: document.createdAt,
      winner: snapshot.winner,
      outcome: snapshot.outcome,
      error: document.error,
    }
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法安全保存 API Key')
    return safeStorage.encryptString(value).toString('base64')
  }

  private decrypt(value: string): string {
    if (!value) return ''
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法读取 API Key')
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
}
