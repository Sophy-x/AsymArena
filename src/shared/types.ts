export type ProviderKind = 'openai-compatible'

export interface ModelProfile {
  id: string
  name: string
  provider: ProviderKind
  baseUrl: string
  model: string
  apiKey: string
}

export type ModelProfileSummary = Omit<ModelProfile, 'apiKey'> & {
  hasApiKey: boolean
}

export type SeatConfig = { id: string; kind: 'model'; profileId: string; name: string } | { id: string; kind: 'human'; name: string }

export interface GameDescriptor {
  id: string
  name: string
  description: string
  version: string
  minSeats: number
  maxSeats: number
  mcpToolCount: number
  configFields: GameConfigField[]
}

export interface GameConfigField {
  key: string
  label: string
  type: 'number' | 'select'
  defaultValue: number | string
  minimum?: number
  maximum?: number
  step?: number
  options?: Array<{ label: string; value: number | string }>
}

export interface PublicSeat {
  id: string
  name: string
  kind: 'model' | 'human'
  alive: boolean
  clue?: string
  role?: string
  word?: string
}

export interface HumanActionField {
  key: string
  label: string
  type: 'text' | 'select'
  required?: boolean
  placeholder?: string
  maxLength?: number
  options?: Array<{ label: string; value: string }>
}

export interface HumanActionSpec {
  tool: string
  label: string
  description?: string
  fields: HumanActionField[]
}

export interface GameSnapshot {
  matchId: string
  gameId: string
  gameName: string
  mcpToolCount: number
  status: 'setup' | 'running' | 'waiting-human' | 'paused' | 'finished'
  phase: string
  phaseLabel: string
  round: number
  maxRounds: number
  currentSeatId?: string
  currentSeatName?: string
  seats: PublicSeat[]
  humanActions?: HumanActionSpec[]
  events: GameEvent[]
  latestVotes?: Record<string, number>
  winner?: string
  outcome?: string
  error?: string
  eloChanges?: EloChange[]
  ratingStatus?: 'pending' | 'counted' | 'excluded'
  ratingReason?: string
}

export interface GameEvent {
  id: string
  time: string
  round: number
  kind: 'system' | 'clue' | 'vote' | 'elimination' | 'error' | 'result' | 'human'
  text: string
  seatId?: string
}

export interface PrivateObservation {
  seatId: string
  role: string
  word: string
  publicState: unknown
}

export interface EloChange {
  profileId: string
  profileName: string
  before: number
  after: number
  delta: number
}

export interface RatingEntry {
  gameId: string
  gameName: string
  profileId: string
  profileName: string
  rating: number
  games: number
  wins: number
  updatedAt: string
}

export interface MatchSummary {
  matchId: string
  gameId: string
  gameName: string
  status: GameSnapshot['status']
  phaseLabel: string
  round: number
  maxRounds: number
  seats: Array<Pick<PublicSeat, 'id' | 'name' | 'kind'>>
  createdAt: string
  winner?: string
  outcome?: string
  error?: string
}

export interface ReplayData {
  snapshot: GameSnapshot
  privateObservations: Array<{
    seatId: string
    round: number
    phase: string
    observation: PrivateObservation
  }>
  roles: Array<{
    seatId: string
    name: string
    role: string
    word: string
    alive: boolean
  }>
  ratingChanges: EloChange[]
}

export type MatchLineup = { mode: 'manual'; seats: SeatConfig[] } | { mode: 'random-models'; seatCount: number; profileIds: string[] }

export interface CreateMatchInput {
  gameId: string
  lineup: MatchLineup
  config: Record<string, unknown>
}

export interface ArenaBridge {
  setTheme(theme: 'carbon' | 'paper' | 'rose'): void
  getBootstrap(): Promise<{
    games: GameDescriptor[]
    profiles: ModelProfileSummary[]
    matches: MatchSummary[]
    ratings: RatingEntry[]
  }>
  saveProfile(profile: ModelProfile): Promise<ModelProfileSummary[]>
  deleteProfile(profileId: string): Promise<ModelProfileSummary[]>
  testProfile(profile: ModelProfile): Promise<string>
  listModels(profile: ModelProfile): Promise<string[]>
  createMatch(input: CreateMatchInput): Promise<GameSnapshot>
  getMatch(matchId: string): Promise<GameSnapshot>
  listMatches(): Promise<MatchSummary[]>
  deleteMatch(matchId: string): Promise<void>
  startMatch(matchId: string): Promise<GameSnapshot>
  getHumanObservation(matchId: string, seatId: string): Promise<PrivateObservation>
  submitHumanAction(matchId: string, seatId: string, tool: string, args: Record<string, unknown>): Promise<GameSnapshot>
  retryMatch(matchId: string): Promise<GameSnapshot>
  getReplay(matchId: string): Promise<ReplayData>
  getRatings(gameId?: string): Promise<RatingEntry[]>
  onMatchUpdated(callback: (snapshot: GameSnapshot) => void): () => void
}

declare global {
  interface Window {
    arena: ArenaBridge
  }
}
