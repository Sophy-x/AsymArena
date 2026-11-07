import type { ChatMessage } from './store'

export function trimConversationHistory(messages: ChatMessage[], maxMessages = 25): void {
  const validMessages: ChatMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'tool') continue
    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      validMessages.push(message)
      continue
    }

    const expectedIds = new Set(message.tool_calls.map((call) => call.id))
    const replies: ChatMessage[] = []
    let cursor = index + 1
    while (messages[cursor]?.role === 'tool') {
      const reply = messages[cursor]
      if (reply.tool_call_id && expectedIds.has(reply.tool_call_id)) replies.push(reply)
      cursor += 1
    }
    const repliedIds = new Set(replies.map((reply) => reply.tool_call_id))
    if ([...expectedIds].every((id) => repliedIds.has(id))) {
      validMessages.push(message, ...replies)
    }
    index = cursor - 1
  }

  const hasSystemMessage = validMessages[0]?.role === 'system'
  const systemMessages = hasSystemMessage ? validMessages.slice(0, 1) : []
  const conversation = hasSystemMessage ? validMessages.slice(1) : validMessages
  const turns: ChatMessage[][] = []
  let turn: ChatMessage[] = []
  for (const message of conversation) {
    if (message.role === 'user' && turn.length) {
      turns.push(turn)
      turn = []
    }
    turn.push(message)
  }
  if (turn.length) turns.push(turn)

  let size = systemMessages.length + turns.reduce((total, item) => total + item.length, 0)
  while (turns.length > 1 && size > maxMessages) {
    size -= turns.shift()!.length
  }
  messages.splice(0, messages.length, ...systemMessages, ...turns.flat())
}
