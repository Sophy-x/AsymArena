import type { ZodTypeAny } from 'zod'
import type { GameDescriptor, GameEvent, GameSnapshot, HumanActionSpec, PrivateObservation, SeatConfig } from '@shared/types'

export interface GameTool {
  name: string
  description: string
  inputSchema: Record<string, ZodTypeAny>
  jsonSchema: Record<string, unknown>
}

export interface GameResult {
  winner: string | null
  teamBySeat: Record<string, string>
  outcome: string
  roles: Array<{ seatId: string; name: string; role: string; word: string; alive: boolean }>
}

export interface GameModule {
  descriptor: GameDescriptor
  validateSeats(seats: SeatConfig[]): void
  create(config: Record<string, unknown>, seats: SeatConfig[]): unknown
  start(state: unknown): unknown
  phase(state: unknown): string
  phaseLabel(state: unknown): string
  round(state: unknown): number
  maxRounds(state: unknown): number
  currentSeatId(state: unknown): string | undefined
  pendingVoterIds?(state: unknown): string[]
  isFinished(state: unknown): boolean
  isWaitingForHuman(state: unknown): boolean
  needsAdvance(state: unknown): boolean
  agentInstructions(state: unknown, seatId: string): string
  humanActions(state: unknown, seatId: string): HumanActionSpec[]
  next(state: unknown): unknown
  tools(state: unknown): GameTool[]
  observation(state: unknown, seatId: string): PrivateObservation
  invoke(state: unknown, seatId: string, toolName: string, args: Record<string, unknown>): { state: unknown; result: unknown }
  publicState(state: unknown): GameSnapshot
  events(state: unknown): GameEvent[]
  result(state: unknown): GameResult | undefined
  replayObservations(state: unknown): Array<{ seatId: string; round: number; phase: string; observation: PrivateObservation }>
}

export type GameStateRecord = Record<string, unknown>
