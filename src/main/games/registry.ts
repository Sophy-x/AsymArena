import type { GameModule } from './contracts'
import { undercoverGame } from './undercover'

export class GameRegistry {
  private readonly games = new Map<string, GameModule>()

  constructor(modules: GameModule[] = [undercoverGame]) {
    for (const game of modules) this.register(game)
  }

  register(game: GameModule): void {
    if (this.games.has(game.descriptor.id)) throw new Error(`Game already registered: ${game.descriptor.id}`)
    this.games.set(game.descriptor.id, game)
  }

  get(gameId: string): GameModule {
    const game = this.games.get(gameId)
    if (!game) throw new Error(`Unknown game module: ${gameId}`)
    return game
  }

  all(): GameModule[] {
    return [...this.games.values()]
  }
}
