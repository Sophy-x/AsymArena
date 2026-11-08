import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGameMcpLink } from '../src/main/mcp/link'
import { undercoverGame } from '../src/main/games/undercover'
import { calculateTeamElo } from '../src/main/ratings/team-elo'
import { getRatingExclusionReason } from '../src/main/ratings/eligibility'
import type { GameSnapshot, SeatConfig } from '../src/shared/types'
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

  it('hides model profile names from agent instructions, observations, and public tool results', () => {
    const profileNames = ['DeepSeek V3', 'GPT-6.1', 'Claude Sonnet', 'Gemini Pro']
    const seats = modelSeats.map((seat, index) => ({ ...seat, name: profileNames[index] }))
    let state = undercoverGame.start(undercoverGame.create({ undercoverCount: 1 }, seats))
    const seatId = undercoverGame.currentSeatId(state)!
    const visibleState = undercoverGame.invoke(state, seatId, 'get_public_state', {}).result
    const observation = undercoverGame.observation(state, seatId)
    const instructions = undercoverGame.agentInstructions(state, seatId)

    for (const profileName of profileNames) {
      expect(JSON.stringify(visibleState)).not.toContain(profileName)
      expect(JSON.stringify(observation.publicState)).not.toContain(profileName)
      expect(instructions).not.toContain(profileName)
    }
    expect(JSON.stringify(visibleState)).toContain('AI Seat 01')

    const actionResult = undercoverGame.invoke(state, seatId, 'submit_clue', { clue: '中性线索' }).result
    expect(JSON.stringify(actionResult)).not.toContain(profileNames.join('|'))
    for (const profileName of profileNames) expect(JSON.stringify(actionResult)).not.toContain(profileName)
  })

  it('rejects actions from seats that do not own the current turn', () => {
    const state = runningState()
    const currentSeatId = undercoverGame.currentSeatId(state)!
    const other = modelSeats.find((seat) => seat.id !== currentSeatId)!
    expect(() => undercoverGame.invoke(state, other.id, 'submit_clue', { clue: '线索' })).toThrow('当前不是该座位的行动回合')
  })

  it('rejects a repeated clue despite case, punctuation, and spacing differences', () => {
    const state = runningState()
    const first = undercoverGame.currentSeatId(state)!
    undercoverGame.invoke(state, first, 'submit_clue', { clue: 'A neutral clue' })
    const second = undercoverGame.currentSeatId(state)!
    expect(() => undercoverGame.invoke(state, second, 'submit_clue', { clue: 'a  neutral clue!' })).toThrow('不能重复')
    expect(undercoverGame.currentSeatId(state)).toBe(second)
  })

  it('accepts secret votes in any order and only tallies after all voters act', () => {
    const state = runningState()
    while (undercoverGame.phase(state) === 'clue') {
      const id = undercoverGame.currentSeatId(state)!
      undercoverGame.invoke(state, id, 'submit_clue', { clue: `独特线索 ${id}` })
    }
    const voters = undercoverGame.pendingVoterIds!(state)
    const last = voters[voters.length - 1]
    undercoverGame.invoke(state, last, 'submit_vote', { target_seat_id: voters[0] })
    expect(undercoverGame.currentSeatId(state)).toBe(voters[0])
    expect(undercoverGame.publicState(state).latestVotes).toBeUndefined()
    expect(() => undercoverGame.invoke(state, last, 'submit_vote', { target_seat_id: voters[0] })).toThrow()
    for (const id of voters.slice(0, -1)) {
      undercoverGame.invoke(state, id, 'submit_vote', { target_seat_id: id === voters[0] ? voters[1] : voters[0] })
    }
    expect(undercoverGame.phase(state)).not.toBe('vote')
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
        undercoverGame.invoke(state, currentSeatId, 'submit_clue', {
          clue: `第${undercoverGame.round(state)}轮线索${currentSeatId}`,
        })
      } else {
        const publicState = undercoverGame.publicState(state)
        const target = publicState.seats.find((seat) => seat.alive && seat.id !== currentSeatId)!
        undercoverGame.invoke(state, currentSeatId, 'submit_vote', {
          target_seat_id: target.id,
        })
      }
    }
    expect(undercoverGame.isFinished(state)).toBe(true)
    expect(undercoverGame.result(state)?.roles).toHaveLength(4)
    expect(undercoverGame.publicState(state).seats.every((seat) => Boolean(seat.role && seat.word))).toBe(true)
  })

  it('has only tied top-vote seats speak again, then repeats a full vote until the top vote is unique', () => {
    let state = undercoverGame.start(undercoverGame.create({ undercoverCount: 1, maxRounds: 4 }, modelSeats))
    const privateState = state as { seats: Array<{ id: string; role: string; alive: boolean }> }
    const candidates = privateState.seats
      .filter((seat) => seat.role === 'civilian')
      .slice(0, 2)
      .map((seat) => seat.id)
    const [candidateA, candidateB] = candidates

    while (undercoverGame.phase(state) === 'clue') {
      const seatId = undercoverGame.currentSeatId(state)!
      undercoverGame.invoke(state, seatId, 'submit_clue', { clue: `线索 ${seatId}` })
    }
    const voters = privateState.seats.map((seat) => seat.id)
    const outsideVoters = voters.filter((seatId) => !candidates.includes(seatId))
    for (const seatId of voters) {
      const target =
        seatId === candidateA ? candidateB : seatId === candidateB ? candidateA : seatId === outsideVoters[0] ? candidateA : candidateB
      const response = undercoverGame.invoke(state, seatId, 'submit_vote', { target_seat_id: target })
      state = response.state
    }

    expect(undercoverGame.phaseLabel(state)).toBe('平票补充发言')
    expect(undercoverGame.publicState(state).latestVotes).toMatchObject({ [candidateA]: 2, [candidateB]: 2 })
    const tieSpeakers: string[] = []
    while (undercoverGame.phase(state) === 'clue') {
      const seatId = undercoverGame.currentSeatId(state)!
      tieSpeakers.push(seatId)
      undercoverGame.invoke(state, seatId, 'submit_clue', { clue: `补充说明 ${seatId}` })
    }
    expect(tieSpeakers.sort()).toEqual([...candidates].sort())
    expect(undercoverGame.phaseLabel(state)).toBe('平票复投')

    for (const seatId of voters) {
      undercoverGame.invoke(state, seatId, 'submit_vote', {
        target_seat_id: seatId === candidateA ? candidateB : candidateA,
      })
    }
    expect(privateState.seats.find((seat) => seat.id === candidateA)?.alive).toBe(false)
    expect(undercoverGame.phase(state)).toBe('review')
  })

  it('tells models to read public speech, infer factions, and bluff for their side', () => {
    const state = runningState()
    const instructions = undercoverGame.agentInstructions(state, modelSeats[0].id)
    expect(instructions).toContain('call get_my_observation')
    expect(instructions).toContain('every other seat’s previous statements')
    expect(instructions).toContain('infer each seat’s likely faction and word')
    expect(instructions).toContain('Hide your own faction')
    expect(instructions).toContain('every clue is visible to all seats')
    expect(instructions).toContain('make your faction win')
    expect(instructions).toContain('short, broad, indirect association')
    expect(instructions).toContain('deliberately ambiguous')
    expect(instructions).toContain('bluff or give plausible false clues')
    expect(instructions).not.toContain('You are a civilian')
    expect(instructions).not.toContain('You are undercover')
  })

  it('makes all prior round statements available through the next round observation', () => {
    let state = undercoverGame.start(undercoverGame.create({ undercoverCount: 1, maxRounds: 4 }, modelSeats))
    const privateSeats = state as { seats: Array<{ id: string; role: string; alive: boolean }> }
    const civilianTarget = privateSeats.seats.find((seat) => seat.role === 'civilian')!.id

    while (undercoverGame.phase(state) === 'clue') {
      const seatId = undercoverGame.currentSeatId(state)!
      const response = undercoverGame.invoke(state, seatId, 'submit_clue', { clue: `round-one-${seatId}` })
      state = response.state
    }
    while (undercoverGame.phase(state) === 'vote') {
      const seatId = undercoverGame.currentSeatId(state)!
      const alternative = privateSeats.seats.find((seat) => seat.id !== civilianTarget)!.id
      const response = undercoverGame.invoke(state, seatId, 'submit_vote', {
        target_seat_id: seatId === civilianTarget ? alternative : civilianTarget,
      })
      state = response.state
    }
    state = undercoverGame.next(state)

    const observation = undercoverGame.observation(state, undercoverGame.currentSeatId(state)!)
    const priorStatements = (observation.publicState as GameSnapshot).events
      .filter((event) => event.kind === 'clue' && event.round === 1)
      .map((event) => event.text)
    expect(priorStatements).toHaveLength(4)
    for (const seat of privateSeats.seats) expect(priorStatements).toContain(`round-one-${seat.id}`)
  })

  it('describes human turn forms from the game module action schema', () => {
    const mixedSeats: SeatConfig[] = [{ id: 'human', kind: 'human', name: 'Local player' }, ...modelSeats.slice(1)]
    let state = undercoverGame.start(undercoverGame.create({ undercoverCount: 1 }, mixedSeats))
    expect(undercoverGame.publicState(state).humanActions?.[0]).toMatchObject({
      tool: 'submit_clue',
      fields: [{ key: 'clue', type: 'text' }],
    })
    undercoverGame.invoke(state, 'human', 'submit_clue', {
      clue: '一种日常物品',
    })
    while (undercoverGame.phase(state) === 'clue') {
      const seatId = undercoverGame.currentSeatId(state)!
      undercoverGame.invoke(state, seatId, 'submit_clue', {
        clue: `其他线索 ${seatId}`,
      })
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
      async (next) => {
        state = next
      },
    )
    try {
      const tools = await mcp.client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(['get_public_state', 'get_my_observation', 'submit_clue'])
      const result = await mcp.client.callTool({
        name: 'get_my_observation',
        arguments: {},
      })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ seatId: currentSeatId })
    } finally {
      await mcp.close()
    }
  })

  it('streams fragmented reasoning and assembles fragmented tool calls before acting', async () => {
    let state = runningState()
    const seatId = undercoverGame.currentSeatId(state)!
    const mcp = await createGameMcpLink(undercoverGame, seatId, () => state, async (next) => { state = next })
    const encoder = new TextEncoder()
    const frames = [
      { choices: [{ delta: { reasoning_content: '先分析' } }] },
      { choices: [{ delta: { reasoning_content: '再行动' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'submit_', arguments: '{"clue":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'clue', arguments: '"宽泛提示"}' } }] } }] },
    ].map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
    const bytes = encoder.encode(frames)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        controller.close()
      },
    })
    const fetchMock = vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const pieces: Array<[string, boolean]> = []
    try {
      await new OpenAICompatibleProvider().takeTurn(
        { id: 'p', name: 'Agent', provider: 'openai-compatible', baseUrl: 'https://example.test', model: 'm', apiKey: 'key' },
        [{ role: 'system', content: 'test' }], mcp,
        (text, isNew) => { pieces.push([text, isNew]) },
      )
      expect(pieces).toEqual([['先分析', true], ['再行动', false]])
      expect(undercoverGame.currentSeatId(state)).not.toBe(seatId)
      expect(undercoverGame.publicState(state).events.some((event) => event.text === '宽泛提示')).toBe(true)
    } finally { await mcp.close() }
  })

  it('routes model tool calls through MCP and advances only after an accepted action', async () => {
    let state = runningState()
    const currentSeatId = undercoverGame.currentSeatId(state)!
    const mcp = await createGameMcpLink(
      undercoverGame,
      currentSeatId,
      () => state,
      async (next) => {
        state = next
      },
    )
    const responses = [
      {
        choices: [
          {
            message: {
              reasoning_content: 'private reasoning for seat zero',
              tool_calls: [
                {
                  id: 'read-1',
                  function: { name: 'get_my_observation', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'act-1',
                  function: {
                    name: 'submit_clue',
                    arguments: '{"clue":"清晨会喝的一种饮品"}',
                  },
                },
              ],
            },
          },
        ],
      },
    ]
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const messages: ChatMessage[] = [{ role: 'system', content: 'Independent seat context.' }]
    const thoughts: string[] = []
    try {
      await new OpenAICompatibleProvider().takeTurn(
        {
          id: 'profile-0',
          name: 'Agent',
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.test/v1',
          model: 'model-x',
          apiKey: 'test-key',
        },
        messages,
        mcp,
        async (text) => { thoughts.push(text) },
      )
      expect(thoughts).toEqual(['private reasoning for seat zero'])
      expect(JSON.stringify(undercoverGame.observation(state, undercoverGame.currentSeatId(state)!))).not.toContain('private reasoning for seat zero')
      expect(JSON.stringify(undercoverGame.publicState(state))).not.toContain('private reasoning for seat zero')
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
    const result = calculateTeamElo(
      [
        {
          id: 'a1',
          name: 'A1',
          profileId: 'a1',
          profileName: 'A1',
          team: 'civilian',
          rating: 1000,
        },
        {
          id: 'a2',
          name: 'A2',
          profileId: 'a2',
          profileName: 'A2',
          team: 'civilian',
          rating: 1000,
        },
        {
          id: 'b1',
          name: 'B1',
          profileId: 'b1',
          profileName: 'B1',
          team: 'undercover',
          rating: 1000,
        },
        {
          id: 'b2',
          name: 'B2',
          profileId: 'b2',
          profileName: 'B2',
          team: 'undercover',
          rating: 1000,
        },
      ],
      { winner: 'civilian' },
    )
    expect(result.changes.find((change) => change.profileId === 'a1')?.delta).toBe(16)
    expect(result.changes.find((change) => change.profileId === 'b1')?.delta).toBe(-16)
  })

  it('uses team averages, supports draws, and only emits one rating per profile', () => {
    const draw = calculateTeamElo(
      [
        {
          id: 'a1',
          name: 'A1',
          profileId: 'shared',
          profileName: 'Shared',
          team: 'civilian',
          rating: 1200,
        },
        {
          id: 'b1',
          name: 'B1',
          profileId: 'shared',
          profileName: 'Shared',
          team: 'undercover',
          rating: 1200,
        },
        {
          id: 'b2',
          name: 'B2',
          profileId: 'b2',
          profileName: 'B2',
          team: 'undercover',
          rating: 1000,
        },
      ],
      { winner: null },
    )
    expect(draw.changes.filter((change) => change.profileId === 'shared')).toHaveLength(1)
    expect(draw.profileScores.get('shared')).toBe(0.5)

    const upset = calculateTeamElo(
      [
        {
          id: 'a1',
          name: 'A1',
          profileId: 'a1',
          profileName: 'A1',
          team: 'civilian',
          rating: 1200,
        },
        {
          id: 'b1',
          name: 'B1',
          profileId: 'b1',
          profileName: 'B1',
          team: 'undercover',
          rating: 1000,
        },
      ],
      { winner: 'undercover' },
    )
    expect(upset.changes.find((change) => change.profileId === 'b1')!.delta).toBeGreaterThan(16)
  })

  it('averages a model appearance across factions instead of assigning it only one role result', () => {
    const result = calculateTeamElo(
      [
        {
          id: 'a1',
          name: 'A1',
          profileId: 'a',
          profileName: 'A',
          team: 'civilian',
          rating: 1000,
        },
        {
          id: 'a2',
          name: 'A2',
          profileId: 'a',
          profileName: 'A',
          team: 'civilian',
          rating: 1000,
        },
        {
          id: 'b1',
          name: 'B civilian',
          profileId: 'b',
          profileName: 'B',
          team: 'civilian',
          rating: 1000,
        },
        {
          id: 'b2',
          name: 'B undercover',
          profileId: 'b',
          profileName: 'B',
          team: 'undercover',
          rating: 1000,
        },
      ],
      { winner: 'undercover' },
    )
    expect(result.changes.find((change) => change.profileId === 'b')?.delta).toBe(0)
    expect(result.changes.find((change) => change.profileId === 'a')?.delta).toBe(-16)
  })
})

describe('rating eligibility', () => {
  const base = {
    gameId: 'undercover',
    mode: 'random-models' as const,
    modelProfileIds: ['a', 'b', 'a', 'b'],
    humanSeats: 0,
  }

  it.each([
    [4, 1],
    [5, 2],
    [6, 2],
  ])('rates standard %i-seat games with %i undercover players', (seatCount, undercoverCount) => {
    expect(getRatingExclusionReason({ ...base, seatCount, undercoverCount })).toBeUndefined()
  })

  it('excludes manual, nonstandard, human, and single-profile games', () => {
    expect(
      getRatingExclusionReason({
        ...base,
        mode: 'manual',
        seatCount: 4,
        undercoverCount: 1,
      }),
    ).toMatch(/手动阵容/)
    expect(getRatingExclusionReason({ ...base, seatCount: 7, undercoverCount: 2 })).toMatch(/4、5、6/)
    expect(getRatingExclusionReason({ ...base, seatCount: 5, undercoverCount: 1 })).toMatch(/标准配置/)
    expect(
      getRatingExclusionReason({
        ...base,
        seatCount: 4,
        undercoverCount: 1,
        humanSeats: 1,
      }),
    ).toMatch(/真人/)
    expect(
      getRatingExclusionReason({
        ...base,
        seatCount: 4,
        undercoverCount: 1,
        modelProfileIds: ['a', 'a'],
      }),
    ).toMatch(/两个不同模型/)
  })
})
