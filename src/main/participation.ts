import type { SeatConfig } from '@shared/types'

export interface ParticipationMatch {
  runStatus: 'setup' | 'running' | 'waiting-human' | 'paused' | 'finished'
  ratingMode: 'manual' | 'random-models'
  seats: SeatConfig[]
}

export interface TrackedParticipationMatch extends ParticipationMatch {
  participationCounted: boolean
}

export function incrementModelSeatParticipations(counts: Record<string, number>, seats: readonly SeatConfig[]): void {
  for (const seat of seats) {
    if (seat.kind === 'model') counts[seat.profileId] = (counts[seat.profileId] ?? 0) + 1
  }
}

export function recordStartedMatchParticipation(match: TrackedParticipationMatch, counts: Record<string, number>): void {
  if (match.ratingMode !== 'random-models' || match.runStatus === 'setup' || match.participationCounted) return
  incrementModelSeatParticipations(counts, match.seats)
  match.participationCounted = true
}

export function countStartedModelSeatParticipations(matches: readonly ParticipationMatch[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const match of matches) {
    if (match.ratingMode === 'random-models' && match.runStatus !== 'setup') {
      incrementModelSeatParticipations(counts, match.seats)
    }
  }
  return counts
}
