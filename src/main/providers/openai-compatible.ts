import type { ModelProfile } from '@shared/types'
import type { ChatMessage } from '../store'
import type { GameMcpLink } from '../mcp/link'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: Array<{
        id: string
        type?: string
        function: { name: string; arguments: string }
      }>
    }
  }>
  error?: { message?: string }
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class OpenAICompatibleProvider {
  async listModels(profile: ModelProfile): Promise<string[]> {
    const response = await this.request(profile, '/models', undefined, 'GET') as { data?: Array<{ id: string }> }
    return (response.data ?? []).map((model) => model.id).filter(Boolean).sort()
  }

  async testConnection(profile: ModelProfile): Promise<string> {
    await this.complete(profile, [{ role: 'user', content: 'Reply with OK.' }])
    return `Connected · ${profile.model}`
  }

  async takeTurn(
    profile: ModelProfile,
    messages: ChatMessage[],
    mcp: GameMcpLink,
    onThought?: (text: string, isNew: boolean) => void | Promise<void>,
    toolChoice: 'auto' | 'required' = 'auto',
  ): Promise<void> {
    const toolList = await mcp.client.listTools()
    const tools = toolList.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    }))
    for (let iteration = 0; iteration < 8; iteration += 1) {
      let hasThought = false
      const emitThought = async (text: string) => {
        if (!text) return
        await onThought?.(text, !hasThought)
        hasThought = true
      }
      const response = await this.complete(profile, messages, tools, emitThought, toolChoice)
      const message = response.choices?.[0]?.message
      if (!message) throw new ProviderError('Model response contained no message')
      const toolCalls = message.tool_calls ?? []
      if (!toolCalls.length) throw new ProviderError('Model returned text without calling a game MCP tool')

      const assistantCalls: NonNullable<ChatMessage['tool_calls']> = toolCalls.map((call, index) => ({
        id: call.id || `call-${iteration}-${index}`,
        type: 'function',
        function: call.function,
      }))
      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: assistantCalls })

      let actionAccepted = false
      for (const call of toolCalls) {
        let args: Record<string, unknown>
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        } catch {
          args = {}
        }
        let result: unknown
        let isError = false
        try {
          if (actionAccepted) throw new Error('Only one game action is allowed per turn')
          result = await mcp.client.callTool({ name: call.function.name, arguments: args })
          isError = Boolean((result as { isError?: boolean }).isError)
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) }
          isError = true
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        })
        if (!isError && ['submit_clue', 'submit_vote'].includes(call.function.name)) {
          actionAccepted = true
        }
      }
      if (actionAccepted) return
    }
    throw new ProviderError('Model exceeded the MCP tool-call limit without a valid action')
  }

  private async complete(
    profile: ModelProfile,
    messages: ChatMessage[],
    tools?: Array<Record<string, unknown>>,
    onThought?: (text: string) => Promise<void>,
    toolChoice: 'auto' | 'required' = 'auto',
  ): Promise<ChatCompletionResponse> {
    const body: Record<string, unknown> = { model: profile.model, messages, reasoning_effort: 'low' }
    if (tools) {
      body.tools = tools
      body.tool_choice = toolChoice
      body.parallel_tool_calls = false
    }
    if (onThought) body.stream = true
    return await this.request(profile, '/chat/completions', body, 'POST', onThought) as ChatCompletionResponse
  }

  private async request(
    profile: ModelProfile,
    path: string,
    body?: Record<string, unknown>,
    method = 'POST',
    onThought?: (text: string) => Promise<void>,
  ): Promise<unknown> {
    const base = profile.baseUrl.trim().replace(/\/+$/, '')
    if (!base) throw new ProviderError('Base URL is required')
    if (!profile.apiKey.trim()) throw new ProviderError('API key is required')
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
          Accept: onThought ? 'text/event-stream, application/json' : 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(90_000),
      })
    } catch (error) {
      throw new ProviderError(error instanceof Error ? error.message : 'Network request failed')
    }
    if (response.ok && onThought && response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
      return this.readStream(response.body, onThought)
    }
    const text = await response.text()
    let payload: ChatCompletionResponse & Record<string, unknown>
    try {
      payload = JSON.parse(text) as ChatCompletionResponse & Record<string, unknown>
    } catch {
      throw new ProviderError(`Provider returned invalid JSON (HTTP ${response.status})`, response.status)
    }
    if (!response.ok) {
      const detail = payload.error?.message ?? text.slice(0, 400)
      throw new ProviderError(`HTTP ${response.status}: ${detail}`, response.status)
    }
    if (onThought) {
      const message = payload.choices?.[0]?.message
      const thought = message?.reasoning_content ?? message?.reasoning ?? message?.content
      if (typeof thought === 'string' && thought) await onThought(thought)
    }
    return payload
  }

  private async readStream(body: ReadableStream<Uint8Array>, onThought: (text: string) => Promise<void>): Promise<ChatCompletionResponse> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let doneEvent = false
    let content = ''
    const calls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>()
    const consume = async (frame: string) => {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) return
      if (data.trim() === '[DONE]') { doneEvent = true; return }
      let chunk: { error?: { message?: string }; choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }> }
      try { chunk = JSON.parse(data) } catch { throw new ProviderError('Provider returned invalid streaming JSON') }
      if (chunk.error) throw new ProviderError(chunk.error.message ?? 'Provider streaming error')
      const delta = chunk.choices?.[0]?.delta
      if (!delta) return
      if (typeof delta.content === 'string') content += delta.content
      const thought = delta.reasoning_content ?? delta.reasoning ?? delta.content
      if (typeof thought === 'string' && thought) await onThought(thought)
      for (const part of delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
        if (part.id) call.id += part.id
        if (part.function?.name) call.function.name += part.function.name
        if (part.function?.arguments) call.function.arguments += part.function.arguments
        calls.set(part.index, call)
      }
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) await consume(frame)
        if (done) break
      }
      if (buffer.trim()) await consume(buffer)
      if (!doneEvent) throw new ProviderError('Provider streaming response ended unexpectedly')
    } finally {
      reader.releaseLock()
    }
    return { choices: [{ message: { content: content || null, tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } }] }
  }
}
