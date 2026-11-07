import { randomInt } from 'node:crypto'

export function buildBalancedProfileAssignments(
  profiles: readonly string[],
  seatCount: number,
  participationCounts: Readonly<Record<string, number>> = {},
  chooseIndex: (upperBound: number) => number = randomInt,
): string[] {
  if (profiles.length === 0) throw new Error('At least one model profile is required')
  if (!Number.isInteger(seatCount) || seatCount < 1) throw new Error('Seat count must be a positive integer')
  if (new Set(profiles).size !== profiles.length) throw new Error('Model profiles must be unique')

  const shuffledProfiles = shuffle([...profiles], chooseIndex)
  const activeProfiles = shuffledProfiles
    .sort((left, right) => (participationCounts[left] ?? 0) - (participationCounts[right] ?? 0))
    .slice(0, Math.min(seatCount, shuffledProfiles.length))
  const baseSeats = Math.floor(seatCount / activeProfiles.length)
  const remainder = seatCount % activeProfiles.length
  const extraSeatProfiles = new Set(
    [...activeProfiles].sort((left, right) => (participationCounts[left] ?? 0) - (participationCounts[right] ?? 0)).slice(0, remainder),
  )
  const assignments = activeProfiles.flatMap((profile) =>
    Array.from({ length: baseSeats + Number(extraSeatProfiles.has(profile)) }, () => profile),
  )
  return shuffle(assignments, chooseIndex)
}

function shuffle(items: string[], chooseIndex: (upperBound: number) => number): string[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = chooseIndex(index + 1)
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new Error('Random index is outside the requested range')
    }
    ;[items[index], items[swapIndex]] = [items[swapIndex], items[index]]
  }
  return items
}
