export interface RatingEligibilityInput {
  gameId: string
  mode: 'manual' | 'random-models'
  seatCount: number
  undercoverCount: number
  modelProfileIds: string[]
  humanSeats: number
}

const standardUndercoverCounts: Record<number, number> = { 4: 1, 5: 2, 6: 2 }

export function getRatingExclusionReason(input: RatingEligibilityInput): string | undefined {
  if (input.mode !== 'random-models') return '手动阵容不计入 Elo；请使用随机模型阵容。'
  if (input.gameId !== 'undercover') return '当前只有谁是卧底支持 Elo 评分。'
  if (input.humanSeats > 0) return '含真人座位的对局不计入 Elo。'
  const expectedUndercoverCount = standardUndercoverCounts[input.seatCount]
  if (expectedUndercoverCount === undefined) return '只有 4、5、6 人局计入 Elo。'
  if (input.undercoverCount !== expectedUndercoverCount) {
    return `${input.seatCount} 人局标准配置为 ${expectedUndercoverCount} 名卧底；其他配置不计入 Elo。`
  }
  if (new Set(input.modelProfileIds).size < 2) {
    return '本次随机分配未抽到至少两个不同模型，不计入 Elo。'
  }
  return undefined
}
