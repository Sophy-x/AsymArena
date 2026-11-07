import { describe, expect, it } from 'vitest'
import { trimConversationHistory } from '../src/main/conversation'
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
