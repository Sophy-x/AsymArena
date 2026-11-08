import type { ChatMessage } from './store'

export function refreshSystemPrompt(messages: ChatMessage[], content: string): void {
  if (messages[0]?.role === 'system') {
    if (messages[0].content !== content) {
      messages.splice(0, messages.length, { role: 'system', content })
    }
  } else {
    messages.unshift({ role: 'system', content })
  }
}

export function anonymizeModelNames(messages: ChatMessage[], aliases: Array<{ name: string; alias: string }>): void {
  const replacements = aliases.filter(({ name }) => name.length > 0).sort((left, right) => right.name.length - left.name.length)

  const anonymize = (value: string): string => replacements.reduce((result, { name, alias }) => result.split(name).join(alias), value)

  for (const message of messages) {
    if (typeof message.content === 'string') message.content = anonymize(message.content)
    for (const toolCall of message.tool_calls ?? []) {
      toolCall.function.arguments = anonymize(toolCall.function.arguments)
    }
  }
}

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
