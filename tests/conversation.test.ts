import { describe, expect, it } from 'vitest'
import { anonymizeModelNames, refreshSystemPrompt, trimConversationHistory } from '../src/main/conversation'
import type { ChatMessage } from '../src/main/store'

function toolCall(id: string): ChatMessage {
  return {
    role: 'assistant',
    tool_calls: [{ id, type: 'function', function: { name: 'inspect', arguments: '{}' } }],
  }
}

function toolReply(id: string): ChatMessage {
  return { role: 'tool', tool_call_id: id, content: '{}' }
}

describe('model conversation history', () => {
  it('refreshes old matches with the current system prompt without dropping their history', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'old instructions' },
      { role: 'user', content: 'prior turn' },
    ]

    refreshSystemPrompt(messages, 'new instructions')

    expect(messages).toEqual([
      { role: 'system', content: 'new instructions' },
      { role: 'user', content: 'prior turn' },
    ])
  })

  it('anonymizes model identities already present in stored context', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Playing as GPT-6.1 against DeepSeek V3.' },
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'inspect',
            type: 'function',
            function: { name: 'inspect', arguments: '{"seat":"DeepSeek V3"}' },
          },
        ],
      },
    ]

    anonymizeModelNames(messages, [
      { name: 'GPT-6.1', alias: 'AI Seat 01' },
      { name: 'DeepSeek V3', alias: 'AI Seat 02' },
    ])

    expect(messages[0].content).toBe('Playing as AI Seat 01 against AI Seat 02.')
    expect(messages[1].tool_calls?.[0].function.arguments).toBe('{"seat":"AI Seat 02"}')
  })

  it('trims whole turns and keeps assistant tool calls paired with every reply', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'older turn' },
      toolCall('old-read'),
      toolReply('old-read'),
      { role: 'assistant', content: 'old text' },
      { role: 'user', content: 'latest turn' },
      toolCall('latest-read'),
      toolReply('latest-read'),
      toolCall('latest-action'),
      toolReply('latest-action'),
    ]

    trimConversationHistory(messages, 6)

    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool'])
    expect(messages[2].tool_calls?.[0].id).toBe('latest-read')
    expect(messages[3].tool_call_id).toBe('latest-read')
    expect(messages[4].tool_calls?.[0].id).toBe('latest-action')
    expect(messages[5].tool_call_id).toBe('latest-action')
  })

  it('repairs stored history containing orphaned tool calls and responses', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'interrupted turn' },
      toolCall('missing-reply'),
      { role: 'user', content: 'next turn' },
      toolReply('orphan-reply'),
    ]

    trimConversationHistory(messages)

    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'interrupted turn' },
      { role: 'user', content: 'next turn' },
    ])
  })
})
