import { randomInt, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { GameEvent, GameSnapshot, HumanActionSpec, PrivateObservation, PublicSeat, SeatConfig } from '@shared/types'
import type { GameModule, GameResult, GameTool } from '../contracts'

interface WordPair {
  civilian: string
  undercover: string
}

type UndercoverSeat = SeatConfig & {
  role: 'civilian' | 'undercover'
  word: string
  alive: boolean
}

interface UndercoverState {
  matchId: string
  config: { undercoverCount: number; maxRounds: number }
  pair: WordPair
  seats: UndercoverSeat[]
  status: 'setup' | 'running' | 'finished'
  phase: 'clue' | 'vote' | 'review' | 'finished'
  tieBreak: boolean
  tieCandidates: string[]
  round: number
  clueIndex: number
  voteIndex: number
  clueOrder: string[]
  voteOrder: string[]
  clues: Array<{ seatId: string; round: number; text: string }>
  votes: Record<string, string>
  events: GameEvent[]
  observations: Array<{
    seatId: string
    round: number
    phase: string
    observation: PrivateObservation
  }>
  winner?: string | null
  outcome?: string
  latestVotes?: Record<string, number>
}

import wordPairsData from './words.json'

const wordPairs = wordPairsData as WordPair[]

const toolSpecs: GameTool[] = [
  {
    name: 'get_public_state',
    description: 'Read public game state. This never includes another seat’s role or word.',
    inputSchema: {},
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_my_observation',
    description: 'Read your assigned word and current public state. Your faction is not disclosed; infer it from the clues.',
    inputSchema: {},
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'submit_clue',
    description: 'Submit one short, indirect clue. Broad or deliberately ambiguous wording is welcome; do not include your exact word or reveal distinctive identifying details.',
    inputSchema: { clue: z.string().min(1).max(80) },
    jsonSchema: {
      type: 'object',
      properties: { clue: { type: 'string', minLength: 1, maxLength: 80 } },
      required: ['clue'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_vote',
    description: 'Secretly vote for a living seat other than yourself.',
    inputSchema: { target_seat_id: z.string().min(1) },
    jsonSchema: {
      type: 'object',
      properties: { target_seat_id: { type: 'string', minLength: 1 } },
      required: ['target_seat_id'],
      additionalProperties: false,
    },
  },
]

function addEvent(state: UndercoverState, kind: GameEvent['kind'], text: string, seatId?: string): void {
  state.events.push({
    id: randomUUID(),
    time: new Date().toISOString(),
    round: state.round,
    kind,
    text,
    seatId,
  })
}

function randomIndex(length: number): number {
  return randomInt(length)
}

function findSeat(state: UndercoverState, seatId: string): UndercoverSeat {
  const seat = state.seats.find((candidate) => candidate.id === seatId)
  if (!seat) throw new Error('Seat not found')
  return seat
}

function publicSeats(state: UndercoverState, reveal = state.status === 'finished'): PublicSeat[] {
  return state.seats.map((seat) => {
    const clue = [...state.clues].reverse().find((entry) => entry.seatId === seat.id && entry.round === state.round)?.text
    return {
      id: seat.id,
      name: seat.name,
      kind: seat.kind,
      alive: seat.alive,
      clue,
      ...(reveal ? { role: seat.role, word: seat.word } : {}),
    }
  })
}

function agentSeatName(state: UndercoverState, seatId: string): string {
  const seatIndex = state.seats.findIndex((seat) => seat.id === seatId)
  const seat = findSeat(state, seatId)
  return seat.kind === 'model' ? `AI Seat ${String(seatIndex + 1).padStart(2, '0')}` : seat.name
}

function agentSnapshot(state: UndercoverState): GameSnapshot {
  const aliases = new Map<string, string>()
  for (const seat of state.seats) {
    if (seat.kind === 'model' && !aliases.has(seat.name)) aliases.set(seat.name, agentSeatName(state, seat.id))
  }
  const replacements = [...aliases].sort(([left], [right]) => right.length - left.length)
  const anonymize = (value: string) => replacements.reduce((result, [name, alias]) => result.split(name).join(alias), value)
  const snapshot = getSnapshot(state)
  if (snapshot.currentSeatId) snapshot.currentSeatName = agentSeatName(state, snapshot.currentSeatId)
  snapshot.seats = snapshot.seats.map((seat) => ({
    ...seat,
    name: seat.kind === 'model' ? agentSeatName(state, seat.id) : seat.name,
  }))
  snapshot.events = snapshot.events.map((event) => ({ ...event, text: anonymize(event.text) }))
  return snapshot
}

function getSnapshot(state: UndercoverState): GameSnapshot {
  const currentSeatId =
    state.status === 'running'
      ? state.phase === 'clue'
        ? state.clueOrder[state.clueIndex]
        : state.phase === 'vote'
          ? state.voteOrder[state.voteIndex]
          : undefined
      : undefined
  const currentSeat = state.seats.find((seat) => seat.id === currentSeatId)
  const status: GameSnapshot['status'] =
    state.status === 'finished'
      ? 'finished'
      : state.status === 'setup'
        ? 'setup'
        : currentSeat?.kind === 'human'
          ? 'waiting-human'
          : 'running'
  const phaseLabel =
    state.tieBreak && state.phase === 'clue'
      ? '平票补充发言'
      : state.tieBreak && state.phase === 'vote'
        ? '平票复投'
        : state.phase === 'clue'
          ? '线索阶段'
          : state.phase === 'vote'
            ? '秘密投票'
            : state.phase === 'review'
              ? '本轮结算'
              : '对局结束'
  const snapshot: GameSnapshot = {
    matchId: state.matchId,
    gameId: 'undercover',
    gameName: '谁是卧底',
    mcpToolCount: toolSpecs.length,
    status,
    phase: state.phase,
    phaseLabel,
    round: state.round,
    maxRounds: state.config.maxRounds,
    currentSeatId,
    currentSeatName: currentSeat?.name,
    seats: publicSeats(state),
    events: [...state.events],
    latestVotes: state.latestVotes,
    winner: state.winner ?? undefined,
    outcome: state.outcome,
  }
  if (currentSeat?.kind === 'human') snapshot.humanActions = undercoverHumanActions(state, currentSeat.id)
  return snapshot
}

function undercoverHumanActions(state: UndercoverState, seatId: string): HumanActionSpec[] {
  if (state.status !== 'running' || currentUndercoverSeat(state) !== seatId) return []
  if (state.phase === 'clue') {
    return [
      {
        tool: 'submit_clue',
        label: state.tieBreak ? '提交补充发言' : '提交线索',
        description: state.tieBreak
          ? '你是并列最高票候选人，请补充发言；之后所有存活玩家会重新投票。'
          : '给出一条不直接包含自己词语的线索。',
        fields: [
          {
            key: 'clue',
            label: state.tieBreak ? '补充发言' : '本轮线索',
            type: 'text',
            required: true,
            maxLength: 80,
            placeholder: state.tieBreak ? '回应质疑并继续隐藏自己的词语' : '描述你的词语，但不要直接说出它',
          },
        ],
      },
    ]
  }
  if (state.phase === 'vote') {
    const clues = new Map(
      [...state.clues]
        .reverse()
        .filter((clue) => clue.round === state.round)
        .map((clue) => [clue.seatId, clue.text]),
    )
    return [
      {
        tool: 'submit_vote',
        label: '确认投票',
        description: '秘密投给一名仍存活且不是自己的玩家。',
        fields: [
          {
            key: 'target_seat_id',
            label: '投票目标',
            type: 'select',
            required: true,
            options: state.seats
              .filter((seat) => seat.alive && seat.id !== seatId)
              .map((seat) => ({
                value: seat.id,
                label: clues.has(seat.id) ? `${seat.name} · ${clues.get(seat.id)}` : seat.name,
              })),
          },
        ],
      },
    ]
  }
  return []
}

function currentUndercoverSeat(state: UndercoverState): string | undefined {
  if (state.phase === 'clue') return state.clueOrder[state.clueIndex]
  if (state.phase === 'vote') return state.voteOrder[state.voteIndex]
  return undefined
}

export const undercoverGame: GameModule = {
  descriptor: {
    id: 'undercover',
    name: '谁是卧底',
    description: '隐藏词语、轮流给线索并投票找出卧底。',
    version: '1.0.0',
    minSeats: 4,
    maxSeats: 10,
    mcpToolCount: toolSpecs.length,
    configFields: [
      {
        key: 'undercoverCount',
        label: '卧底人数',
        type: 'number',
        defaultValue: 1,
        minimum: 1,
        maximum: 4,
        step: 1,
      },
      {
        key: 'maxRounds',
        label: '最大轮数',
        type: 'select',
        defaultValue: 20,
        options: [5, 10, 20, 30, 50, 99].map((value) => ({
          label: `${value} 轮`,
          value,
        })),
      },
    ],
  },

  validateSeats(seats) {
    if (seats.length < 4 || seats.length > 10) throw new Error('谁是卧底需要 4–10 个座位')
  },

  create(config, seats) {
    this.validateSeats(seats)
    const undercoverCount = Number(config.undercoverCount ?? 1)
    const maxRounds = Number(config.maxRounds ?? 20)
    if (!Number.isInteger(undercoverCount) || undercoverCount < 1 || undercoverCount >= seats.length / 2) {
      throw new Error('卧底人数必须至少为 1 且少于平民人数')
    }
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 99) throw new Error('最大轮数须为 1–99')
    const pair = wordPairs[randomIndex(wordPairs.length)]
    const shuffledSeats = [...seats]
    for (let index = shuffledSeats.length - 1; index > 0; index -= 1) {
      const swap = randomIndex(index + 1)
      ;[shuffledSeats[index], shuffledSeats[swap]] = [shuffledSeats[swap], shuffledSeats[index]]
    }
    const undercoverIds = new Set(shuffledSeats.slice(0, undercoverCount).map((seat) => seat.id))
    const assigned = seats.map((seat) => ({
      ...seat,
      role: (undercoverIds.has(seat.id) ? 'undercover' : 'civilian') as UndercoverSeat['role'],
      word: undercoverIds.has(seat.id) ? pair.undercover : pair.civilian,
      alive: true,
    }))
    const state: UndercoverState = {
      matchId: randomUUID(),
      config: { undercoverCount, maxRounds },
      pair,
      seats: assigned,
      status: 'setup',
      phase: 'clue',
      tieBreak: false,
      tieCandidates: [],
      round: 1,
      clueIndex: 0,
      voteIndex: 0,
      clueOrder: assigned.map((seat) => seat.id),
      voteOrder: [],
      clues: [],
      votes: {},
      events: [],
      observations: [],
    }
    addEvent(state, 'system', `对局创建 · ${assigned.length} 个座位 · ${undercoverCount} 名卧底`)
    return state
  },

  start(raw) {
    const state = raw as UndercoverState
    if (state.status !== 'setup') throw new Error('对局已启动')
    state.status = 'running'
    addEvent(state, 'system', '第 1 轮开始')
    return state
  },

  phase(raw) {
    return (raw as UndercoverState).phase
  },
  phaseLabel(raw) {
    return getSnapshot(raw as UndercoverState).phaseLabel
  },
  round(raw) {
    return (raw as UndercoverState).round
  },
  maxRounds(raw) {
    return (raw as UndercoverState).config.maxRounds
  },
  currentSeatId(raw) {
    const state = raw as UndercoverState
    if (state.status !== 'running') return undefined
    if (state.phase === 'clue') return state.clueOrder[state.clueIndex]
    if (state.phase === 'vote') return state.voteOrder[state.voteIndex]
    return undefined
  },
  pendingVoterIds(raw) {
    const state = raw as UndercoverState
    return state.status === 'running' && state.phase === 'vote'
      ? state.voteOrder.filter((id) => !state.votes[id])
      : []
  },
  isFinished(raw) {
    return (raw as UndercoverState).status === 'finished'
  },
  needsAdvance(raw) {
    const state = raw as UndercoverState
    return state.status === 'running' && state.phase === 'review'
  },
  agentInstructions(raw, seatId) {
    const state = raw as UndercoverState
    return [
      `You are ${agentSeatName(state, seatId)}, seat ${seatId}, playing Who’s Undercover.`,
      'A round has one clue from every living seat followed by one secret vote from every living seat.',
      'If the highest vote is tied, only the tied candidates make an additional statement; then all living seats vote again. Repeat until exactly one seat has the highest vote. Tied ballots do not eliminate anyone.',
      'After a unique highest vote, that seat is eliminated without revealing its role.',
      'Civilians win when all undercover seats are eliminated. Undercover wins when the undercover count reaches the civilian count.',
      'Before every action, call get_my_observation to read your assigned word and the complete public event history, including your own and every other seat’s previous statements. Your faction is not disclosed; infer your own and each other seat’s likely faction from the word and public clues. Treat guesses as uncertain.',
      'Hide your own faction: every clue is visible to all seats, so avoid wording that reveals your role or makes your word easy for opponents to identify.',
      'Your goal is to make your faction win. For every clue, prioritize protecting your word over explaining it: use a short, broad, indirect association that could plausibly fit several words. You may be deliberately ambiguous, evasive or mildly misleading when strategically useful. Avoid lists of distinctive features, precise functions, specific settings, obvious synonyms and descriptions that let others immediately guess the word. Give only a minimal signal, not a definition or a detailed explanation. Never state your exact word.',
      'Each clue or additional statement must contribute a new point: do not repeat or paraphrase any earlier statement in this game, including your own.',
      'Choose what to say and do to help your faction; bluff or give plausible false clues when useful.',
      'Use the available MCP tools to submit one legal action.',
    ].join(' ')
  },
  isWaitingForHuman(raw) {
    const state = raw as UndercoverState
    const current = state.seats.find((seat) => seat.id === this.currentSeatId(state))
    return current?.kind === 'human'
  },

  next(raw) {
    const state = raw as UndercoverState
    if (state.status !== 'running' || state.phase !== 'review') return state
    state.round += 1
    state.phase = 'clue'
    state.tieBreak = false
    state.tieCandidates = []
    state.clueOrder = state.seats.filter((seat) => seat.alive).map((seat) => seat.id)
    state.clueIndex = 0
    state.voteOrder = []
    state.voteIndex = 0
    state.votes = {}
    state.latestVotes = undefined
    addEvent(state, 'system', `第 ${state.round} 轮开始`)
    return state
  },

  tools(raw) {
    const state = raw as UndercoverState
    return toolSpecs
      .filter((tool) => {
        if (tool.name === 'submit_clue') return state.phase === 'clue' && state.status === 'running'
        if (tool.name === 'submit_vote') return state.phase === 'vote' && state.status === 'running'
        return true
      })
      .map((tool) =>
        tool.name === 'submit_clue' && state.tieBreak
          ? {
              ...tool,
              description:
                'As a tied top-vote candidate, make one brief, indirect additional statement. Broad or deliberately ambiguous wording is welcome; do not reveal your word or distinctive identifying details. All living seats will then vote again.',
            }
          : tool,
      )
  },

  observation(raw, seatId) {
    const state = raw as UndercoverState
    const seat = findSeat(state, seatId)
    const observation: PrivateObservation = {
      seatId,
      role: seat.role === 'undercover' ? '卧底' : '平民',
      word: seat.word,
      publicState: agentSnapshot(state),
    }
    state.observations.push({
      seatId,
      round: state.round,
      phase: state.phase,
      observation,
    })
    return observation
  },

  playerObservation(raw, seatId) {
    const { role: _role, ...observation } = this.observation(raw, seatId)
    return observation
  },

  modelObservation(raw, seatId) {
    const state = raw as UndercoverState
    return { state, result: this.playerObservation(state, seatId) }
  },

  invoke(raw, seatId, toolName, args) {
    const state = raw as UndercoverState
    const seat = findSeat(state, seatId)
    if (toolName === 'get_public_state') return { state, result: agentSnapshot(state) }
    if (toolName === 'get_my_observation') return { state, result: this.observation(state, seatId) }
    const canVote = toolName === 'submit_vote' && state.phase === 'vote' && state.voteOrder.includes(seatId) && !state.votes[seatId]
    if (state.status !== 'running' || (!canVote && this.currentSeatId(state) !== seatId)) throw new Error('当前不是该座位的行动回合')

    if (toolName === 'submit_clue') {
      if (state.phase !== 'clue') throw new Error('当前不是线索阶段')
      const clue = String(args.clue ?? '')
        .trim()
        .replace(/\s+/g, ' ')
      if (!clue) throw new Error('线索不能为空')
      const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
      if (state.clues.some((previous) => normalized(previous.text) === normalized(clue))) throw new Error('线索不能重复本局之前的发言，请提供新的要点')
      if (clue.length > 80) throw new Error('线索不能超过 80 个字符')
      if (clue.toLocaleLowerCase().includes(seat.word.toLocaleLowerCase())) throw new Error('线索不能直接包含自己的词语')
      state.clues.push({ seatId, round: state.round, text: clue })
      addEvent(state, 'clue', clue, seatId)
      state.clueIndex += 1
      if (state.clueIndex >= state.clueOrder.length) {
        state.phase = 'vote'
        state.voteOrder = state.seats.filter((candidate) => candidate.alive).map((candidate) => candidate.id)
        state.voteIndex = 0
        addEvent(state, 'system', state.tieBreak ? '补充发言完成 · 所有存活玩家重新秘密投票' : '线索收集完成 · 进入秘密投票')
      }
      return {
        state,
        result: { accepted: true, publicState: agentSnapshot(state) },
      }
    }

    if (toolName === 'submit_vote') {
      if (state.phase !== 'vote') throw new Error('当前不是投票阶段')
      const targetId = String(args.target_seat_id ?? '')
      const target = findSeat(state, targetId)
      if (targetId === seatId) throw new Error('不能投给自己')
      if (!target.alive) throw new Error('不能投给已淘汰的座位')
      state.votes[seatId] = targetId
      while (state.voteIndex < state.voteOrder.length && state.votes[state.voteOrder[state.voteIndex]]) state.voteIndex += 1
      if (state.voteIndex < state.voteOrder.length) return { state, result: { accepted: true } }

      const counts = Object.values(state.votes).reduce<Record<string, number>>((result, id) => {
        result[id] = (result[id] ?? 0) + 1
        return result
      }, {})
      const high = Math.max(...Object.values(counts))
      const leaders = Object.keys(counts).filter((id) => counts[id] === high)
      state.latestVotes = counts
      state.votes = {}

      if (leaders.length > 1) {
        state.tieBreak = true
        state.tieCandidates = leaders
        state.phase = 'clue'
        state.clueOrder = leaders
        state.clueIndex = 0
        state.voteOrder = []
        state.voteIndex = 0
        addEvent(
          state,
          'system',
          `最高票平票 · ${leaders.map((id) => findSeat(state, id).name).join('、')} 补充发言后，全体存活玩家重新投票`,
        )
        return {
          state,
          result: {
            accepted: true,
            counts,
            tiedSeatIds: leaders,
            tieBreak: true,
          },
        }
      }

      const eliminatedId = leaders[0]
      findSeat(state, eliminatedId).alive = false
      addEvent(state, 'elimination', `${findSeat(state, eliminatedId).name} 被淘汰 · 身份暂不公开`, eliminatedId)
      state.tieBreak = false
      state.tieCandidates = []

      const spies = state.seats.filter((candidate) => candidate.alive && candidate.role === 'undercover').length
      const civilians = state.seats.filter((candidate) => candidate.alive && candidate.role === 'civilian').length
      if (spies === 0) {
        state.status = 'finished'
        state.phase = 'finished'
        state.winner = 'civilian'
        state.outcome = '卧底全部出局 · 平民阵营获胜'
      } else if (spies >= civilians) {
        state.status = 'finished'
        state.phase = 'finished'
        state.winner = 'undercover'
        state.outcome = '卧底人数达到平民人数 · 卧底阵营获胜'
      } else if (state.round >= state.config.maxRounds) {
        state.status = 'finished'
        state.phase = 'finished'
        state.winner = null
        state.outcome = '达到最大轮数 · 本局平局'
      } else {
        state.phase = 'review'
      }
      if (state.status === 'finished') addEvent(state, 'result', state.outcome ?? '对局结束')
      return {
        state,
        result: {
          accepted: true,
          counts,
          eliminatedSeatId: eliminatedId,
          outcome: state.outcome,
        },
      }
    }

    throw new Error(`Unknown game tool: ${toolName}`)
  },

  publicState(raw) {
    return getSnapshot(raw as UndercoverState)
  },
  humanActions(raw, seatId) {
    return undercoverHumanActions(raw as UndercoverState, seatId)
  },
  events(raw) {
    return [...(raw as UndercoverState).events]
  },
  result(raw): GameResult | undefined {
    const state = raw as UndercoverState
    if (state.status !== 'finished') return undefined
    return {
      winner: state.winner ?? null,
      teamBySeat: Object.fromEntries(state.seats.map((seat) => [seat.id, seat.role])),
      outcome: state.outcome ?? '对局结束',
      roles: state.seats.map((seat) => ({
        seatId: seat.id,
        name: seat.name,
        role: seat.role === 'undercover' ? '卧底' : '平民',
        word: seat.word,
        alive: seat.alive,
      })),
    }
  },
  replayObservations(raw) {
    return [...(raw as UndercoverState).observations]
  },
}
