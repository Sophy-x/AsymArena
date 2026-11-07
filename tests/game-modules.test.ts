import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGameMcpLink } from '../src/main/mcp/link'
import { undercoverGame } from '../src/main/games/undercover'
import { calculateTeamElo } from '../src/main/ratings/team-elo'
import type { SeatConfig } from '../src/shared/types'
import type { ChatMessage } from '../src/main/store'
import { OpenAICompatibleProvider } from '../src/main/providers/openai-compatible'

const modelSeats: SeatConfig[] = Array.from({ length: 4 }, (_, index) => ({
  id: `seat-${index}`,
  kind: 'model',
  profileId: `profile-${index}`,
  name: `Agent ${index + 1}`,
}))

function runningState() {
  return undercoverGame.start(undercoverGame.create({ undercoverCount: 1, maxRounds: 4 }, modelSeats))
}

afterEach(() => vi.unstubAllGlobals())

describe('game module contract', () => {
  it('keeps private roles and words out of the public state', () => {
    const state = runningState()
    const snapshot = undercoverGame.publicState(state)
    expect(snapshot.seats).toHaveLength(4)
    expect(snapshot.seats.every((seat) => !('role' in seat) && !('word' in seat))).toBe(true)
    const firstSeat = (state as { seats: Array<{ id: string }> }).seats[0]
    const observation = undercoverGame.observation(state, firstSeat.id)
    expect(observation.role).toMatch(/平民|卧底/)
    expect(observation.word).toBeTruthy()
  })

  it('rejects actions from seats that do not own the current turn', () => {
    const state = runningState()
    const currentSeatId = undercoverGame.currentSeatId(state)!
    const other = modelSeats.find((seat) => seat.id !== currentSeatId)!
    expect(() => undercoverGame.invoke(state, other.id, 'submit_clue', { clue: '线索' })).toThrow('当前不是该座位的行动回合')
  })

  it('can play every phase through the game module contract until a result is reached', () => {
    let state = undercoverGame.start(undercoverGame.create({ undercoverCount: 1, maxRounds: 4 }, modelSeats))
    for (let safety = 0; safety < 80 && !undercoverGame.isFinished(state); safety += 1) {
      if (undercoverGame.needsAdvance(state)) {
        state = undercoverGame.next(state)
        continue
      }
      const currentSeatId = undercoverGame.currentSeatId(state)!
      if (undercoverGame.phase(state) === 'clue') {
        undercoverGame.invoke(state, currentSeatId, 'submit_clue', { clue: `第${undercoverGame.round(state)}轮线索${currentSeatId}` })
      } else {
        const publicState = undercoverGame.publicState(state)
        const target = publicState.seats.find((seat) => seat.alive && seat.id !== currentSeatId)!
        undercoverGame.invoke(state, currentSeatId, 'submit_vote', { target_seat_id: target.id })
      }
    }
    expect(undercoverGame.isFinished(state)).toBe(true)
    expect(undercoverGame.result(state)?.roles).toHaveLength(4)
  })

  it('describes human turn forms from the game module action schema', () => {
    const mixedSeats: SeatConfig[] = [
      { id: 'human', kind: 'human', name: 'Local player' },
      ...modelSeats.slice(1),
    ]
    let state = undercoverGame.start(undercoverGame.create({ undercoverCount: 1 }, mixedSeats))
    expect(undercoverGame.publicState(state).humanActions?.[0]).toMatchObject({
      tool: 'submit_clue',
      fields: [{ key: 'clue', type: 'text' }],
    })
    undercoverGame.invoke(state, 'human', 'submit_clue', { clue: '一种日常物品' })
    while (undercoverGame.phase(state) === 'clue') {
      const seatId = undercoverGame.currentSeatId(state)!
      undercoverGame.invoke(state, seatId, 'submit_clue', { clue: `其他线索 ${seatId}` })
    }
    expect(undercoverGame.publicState(state).humanActions?.[0]).toMatchObject({
      tool: 'submit_vote',
      fields: [{ key: 'target_seat_id', type: 'select', options: expect.any(Array) }],
    })
  })

  it('exposes game-owned MCP tools through the MCP SDK client', async () => {
    let state = runningState()
    const currentSeatId = undercoverGame.currentSeatId(state)!
    const mcp = await createGameMcpLink(
      undercoverGame,
      currentSeatId,
      () => state,
      async (next) => { state = next },
    )
    try {
      const tools = await mcp.client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'get_public_state',
        'get_my_observation',
        'submit_clue',
      ])
      const result = await mcp.client.callTool({ name: 'get_my_observation', arguments: {} })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ seatId: currentSeatId })
    } finally {
      await mcp.close()
    }
  })

  it('routes model tool calls through MCP and advances only after an accepted action', async () => {
    let state = runningState()
    const currentSeatId = undercoverGame.currentSeatId(state)!
    const mcp = await createGameMcpLink(
      undercoverGame,
      currentSeatId,
      () => state,
      async (next) => { state = next },
    )
    const responses = [
      {
        choices: [{ message: { tool_calls: [{ id: 'read-1', function: { name: 'get_my_observation', arguments: '{}' } }] } }],
      },
      {
        choices: [{ message: { tool_calls: [{ id: 'act-1', function: { name: 'submit_clue', arguments: '{"clue":"清晨会喝的一种饮品"}' } }] } }],
      },
    ]
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const messages: ChatMessage[] = [{ role: 'system', content: 'Independent seat context.' }]
    try {
      await new OpenAICompatibleProvider().takeTurn({
        id: 'profile-0',
        name: 'Agent',
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        model: 'model-x',
        apiKey: 'test-key',
      }, messages, mcp)
      expect(undercoverGame.phase(state)).toBe('clue')
      expect(undercoverGame.currentSeatId(state)).not.toBe(currentSeatId)
      expect(messages.some((message) => message.role === 'tool')).toBe(true)
      const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
      expect(requests[0]).not.toHaveProperty('temperature')
      expect(requests[0].tools.length).toBe(3)
    } finally {
      await mcp.close()
    }
  })
})

describe('team Elo', () => {
  it('moves equally-rated winning and losing teams in opposite directions', () => {
    const result = calculateTeamElo([
      { id: 'a1', name: 'A1', profileId: 'a1', profileName: 'A1', team: 'civilian', rating: 1000 },
      { id: 'a2', name: 'A2', profileId: 'a2', profileName: 'A2', team: 'civilian', rating: 1000 },
      { id: 'b1', name: 'B1', profileId: 'b1', profileName: 'B1', team: 'undercover', rating: 1000 },
      { id: 'b2', name: 'B2', profileId: 'b2', profileName: 'B2', team: 'undercover', rating: 1000 },
    ], { winner: 'civilian' })
    expect(result.changes.find((change) => change.profileId === 'a1')?.delta).toBe(16)
    expect(result.changes.find((change) => change.profileId === 'b1')?.delta).toBe(-16)
  })

  it('uses team averages, supports draws, and only emits one rating per profile', () => {
    const draw = calculateTeamElo([
      { id: 'a1', name: 'A1', profileId: 'shared', profileName: 'Shared', team: 'civilian', rating: 1200 },
      { id: 'b1', name: 'B1', profileId: 'shared', profileName: 'Shared', team: 'undercover', rating: 1200 },
      { id: 'b2', name: 'B2', profileId: 'b2', profileName: 'B2', team: 'undercover', rating: 1000 },
    ], { winner: null })
    expect(draw.changes.filter((change) => change.profileId === 'shared')).toHaveLength(1)
    expect(draw.profileScores.get('shared')).toBe(0.5)

    const upset = calculateTeamElo([
      { id: 'a1', name: 'A1', profileId: 'a1', profileName: 'A1', team: 'civilian', rating: 1200 },
      { id: 'b1', name: 'B1', profileId: 'b1', profileName: 'B1', team: 'undercover', rating: 1000 },
    ], { winner: 'undercover' })
    expect(upset.changes.find((change) => change.profileId === 'b1')!.delta).toBeGreaterThan(16)
  })
})
