import { describe, expect, it } from 'vitest'
import { countStartedModelSeatParticipations, recordStartedMatchParticipation } from '../src/main/participation'
import type { TrackedParticipationMatch } from '../src/main/participation'
import { buildBalancedProfileAssignments } from '../src/main/random-lineup'
import type { SeatConfig } from '../src/shared/types'

function counts(assignments: string[]): Record<string, number> {
  return assignments.reduce<Record<string, number>>((result, profileId) => {
    result[profileId] = (result[profileId] ?? 0) + 1
    return result
  }, {})
}

const keepOrder = (upperBound: number) => upperBound - 1

describe('balanced random lineups', () => {
  it('assigns two profiles three seats each in a six-seat match', () => {
    const assignments = buildBalancedProfileAssignments(['deepseek', 'gpt'], 6, {}, keepOrder)

    expect(counts(assignments)).toEqual({ deepseek: 3, gpt: 3 })
  })

  it('assigns six seats evenly across three profiles', () => {
    const assignments = buildBalancedProfileAssignments(['a', 'b', 'c'], 6, {}, keepOrder)

    expect(counts(assignments)).toEqual({ a: 2, b: 2, c: 2 })
  })

  it('gives remainder seats to profiles with fewer historical appearances', () => {
    const assignments = buildBalancedProfileAssignments(['a', 'b', 'c'], 8, { a: 10, b: 2, c: 4 }, keepOrder)

    expect(counts(assignments)).toEqual({ b: 3, c: 3, a: 2 })
  })

  it('selects the least-used profiles without replacement when the pool exceeds seats', () => {
    const assignments = buildBalancedProfileAssignments(['a', 'b', 'c', 'd'], 2, { a: 9, b: 1, c: 4, d: 0 }, keepOrder)

    expect(assignments).toEqual(['d', 'b'])
  })

  it('randomizes which equally used profile gets a remainder seat', () => {
    const first = buildBalancedProfileAssignments(['a', 'b', 'c'], 8, {}, keepOrder)
    const second = buildBalancedProfileAssignments(['a', 'b', 'c'], 8, {}, () => 0)

    expect(Object.values(counts(first)).sort()).toEqual([2, 3, 3])
    expect(Object.values(counts(second)).sort()).toEqual([2, 3, 3])
    expect(Object.keys(counts(first)).find((id) => counts(first)[id] === 2)).not.toBe(
      Object.keys(counts(second)).find((id) => counts(second)[id] === 2),
    )
  })

  it('counts started model seats, including duplicate seats, but ignores unstarted matches', () => {
    const modelSeat = (id: string, profileId: string): SeatConfig => ({
      id,
      profileId,
      kind: 'model',
      name: id,
    })
    const seats: SeatConfig[] = [
      modelSeat('a1', 'a'),
      modelSeat('a2', 'a'),
      { id: 'human', kind: 'human', name: 'Human' },
      modelSeat('b1', 'b'),
    ]

    expect(
      countStartedModelSeatParticipations([
        { runStatus: 'finished', seats },
        { runStatus: 'setup', seats: [modelSeat('b2', 'b')] },
        { runStatus: 'paused', seats: [modelSeat('b3', 'b')] },
      ]),
    ).toEqual({ a: 2, b: 2 })
  })

  it('records a match only once after it starts', () => {
    const match: TrackedParticipationMatch = {
      runStatus: 'setup',
      participationCounted: false,
      seats: [{ id: 'a1', profileId: 'a', kind: 'model' as const, name: 'A' }],
    }
    const counts: Record<string, number> = {}

    recordStartedMatchParticipation(match, counts)
    expect(counts).toEqual({})

    match.runStatus = 'running'
    recordStartedMatchParticipation(match, counts)
    recordStartedMatchParticipation(match, counts)
    expect(counts).toEqual({ a: 1 })
    expect(match.participationCounted).toBe(true)
  })
})
