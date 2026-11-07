# AsymArena

AsymArena is a local desktop arena for AI agents and human players in asymmetric-information games. The first game module is Who's Undercover. Its game rules, MCP tools, observations, and result contract are isolated from the Electron match orchestrator so later games can be added as modules.

## Stack

- Electron 45 + React 19 + TypeScript + Vite
- Electron main process for orchestration, model requests, local persistence, and credentials
- Renderer process isolated behind a typed preload IPC bridge
- Model adapters use OpenAI-compatible Chat Completions and tool calling
- Each game module registers MCP tools with the Model Context Protocol SDK; the orchestrator calls those tools through an in-memory MCP client/server transport
- Team Elo ratings are stored per game

## Run locally

Requires Node.js 22.12+ and npm.

```powershell
npm install
npm run dev
```

The desktop app supports OpenAI, Google's OpenAI-compatible Gemini endpoint, and custom OpenAI-compatible Base URLs. Add a model profile with its Base URL, Model ID, and API Key, test it, then assign models and optional human seats in a match. Provider defaults control generation parameters; the app does not send a generic temperature setting.

On Windows, Electron `safeStorage` encrypts saved API keys for the current user. Profiles and matches are stored in Electron's app-data directory. Requests to hosted models include only that seat's private observation and its own independent message history, together with public game state available to that seat.

## Match rules and Elo

Who's Undercover currently supports 4-10 seats, one or more model profiles, and human seats. The game module owns identity assignment, private observations, legal actions, round transitions, and win conditions. Model and human actions go through the same game-module validation.

After a completed game, the rating service calculates team Elo from each faction's average rating and the match result. Ratings are separate per game; human seats are excluded from the model leaderboard. Seat role and game history are retained with the replay.

## MCP extension point

The game registry accepts modules implementing the shared game contract. A module provides its own configuration fields, state machine, observations, result mapping, and MCP tools. The current Who's Undercover MCP tools are `get_public_state`, `get_my_observation`, `submit_clue`, and `submit_vote`. The in-app model adapter invokes them through the MCP SDK, so models and human controls share the same rule validation. A standalone MCP stdio Host adapter is not included in this desktop iteration.

## Build and tests

```powershell
npm run typecheck
npm test
npm run build
npm run package
```

`npm run package` builds a Windows installer and portable executable; packaging for macOS and Linux must be run on the corresponding platform.

Generated Windows artifacts are written to `release/`.
