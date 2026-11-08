import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { GameModule } from '../games/contracts'

export interface GameMcpLink {
  client: Client
  close(): Promise<void>
}

export async function createGameMcpLink(
  game: GameModule,
  seatId: string,
  readState: () => unknown,
  writeState: (state: unknown) => Promise<void>,
): Promise<GameMcpLink> {
  const server = new McpServer({
    name: `asymarena-${game.descriptor.id}`,
    version: game.descriptor.version,
  })

  for (const tool of game.tools(readState())) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args): Promise<CallToolResult> => {
        try {
          const invocation =
            tool.name === 'get_my_observation'
              ? game.modelObservation(readState(), seatId)
              : game.invoke(readState(), seatId, tool.name, args)
          const { state, result } = invocation
          await writeState(state)
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          }
        }
      },
    )
  }

  const client = new Client({ name: 'asymarena-main-controller', version: '0.2.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    async close() {
      await Promise.allSettled([client.close(), server.close()])
    },
  }
}
