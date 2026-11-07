import type { EloChange } from '@shared/types'
import type { GameResult } from '../games/contracts'
import type { SeatConfig } from '@shared/types'

export interface RatedSeat {
  id: string
  name: string
  profileId: string
  profileName: string
  team: string
  rating: number
}

export interface TeamEloResult {
  changes: EloChange[]
  profileScores: Map<string, number>
}

export function calculateTeamElo(
  seats: RatedSeat[],
  result: Pick<GameResult, 'winner'>,
  kFactor = 32,
): TeamEloResult {
  const teams = new Map<string, RatedSeat[]>()
  for (const seat of seats) {
    const team = teams.get(seat.team) ?? []
    team.push(seat)
    teams.set(seat.team, team)
  }
  if (teams.size !== 2) return { changes: [], profileScores: new Map() }

  const teamNames = [...teams.keys()]
  const [firstName, secondName] = teamNames
  const first = teams.get(firstName)!
  const second = teams.get(secondName)!
  const firstAverage = mean(first.map((seat) => seat.rating))
  const secondAverage = mean(second.map((seat) => seat.rating))
  const expectedFirst = 1 / (1 + 10 ** ((secondAverage - firstAverage) / 400))
  const scoreFirst = result.winner === null ? 0.5 : result.winner === firstName ? 1 : 0
  const firstDelta = kFactor * (scoreFirst - expectedFirst)
  const secondDelta = kFactor * ((1 - scoreFirst) - (1 - expectedFirst))

  const perProfile = new Map<string, { seats: RatedSeat[]; deltas: number[]; scores: number[] }>()
  for (const [teamName, team, delta] of [[firstName, first, firstDelta], [secondName, second, secondDelta]] as const) {
    const score = result.winner === null ? 0.5 : result.winner === teamName ? 1 : 0
    for (const seat of team) {
      const profile = perProfile.get(seat.profileId) ?? { seats: [], deltas: [], scores: [] }
      profile.seats.push(seat)
      profile.deltas.push(delta)
      profile.scores.push(score)
      perProfile.set(seat.profileId, profile)
    }
  }

  const changes: EloChange[] = []
  const profileScores = new Map<string, number>()
  for (const [profileId, profile] of perProfile) {
    const firstSeat = profile.seats[0]
    const before = firstSeat.rating
    const delta = mean(profile.deltas)
    const after = Math.round((before + delta) * 100) / 100
    changes.push({
      profileId,
      profileName: firstSeat.profileName,
      before,
      after,
      delta: Math.round((after - before) * 100) / 100,
    })
    profileScores.set(profileId, mean(profile.scores))
  }
  return { changes, profileScores }
}

export function modelSeatsForResult(
  seats: SeatConfig[],
  result: GameResult,
  ratings: Map<string, { rating: number; profileName: string }>,
): RatedSeat[] {
  return seats.flatMap((seat) => {
    if (seat.kind !== 'model') return []
    const rating = ratings.get(seat.profileId)
    if (!rating) return []
    return [{
      id: seat.id,
      name: seat.name,
      profileId: seat.profileId,
      profileName: rating.profileName,
      team: result.teamBySeat[seat.id],
      rating: rating.rating,
    }]
  })
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
