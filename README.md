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

On Windows, Electron `safeStorage` encrypts saved API keys for the current user. The installer and `npm run dev` store profiles and matches in `%APPDATA%/asymarena/arena.json`. The portable executable stores them beside itself in `AsymArenaData/arena.json`; on its first launch, an existing roaming store is copied there without deleting the original. Each seat retains its own message history across rounds within a match; different seats and different matches have separate histories. Requests to hosted models include only that seat's private observation and its own history, together with public game state available to that seat.

Model profile names are replaced with neutral seat labels in agent instructions and all game data returned through MCP. Agents can distinguish seats and whether they are model or human seats, but cannot identify another seat's configured model profile from the game interface. The local operator view retains profile names.

## Match rules and Elo

Who's Undercover currently supports 4-10 seats, one or more model profiles, and human seats. The game module owns identity assignment, private observations, legal actions, round transitions, and win conditions. A tied highest vote starts a same-round tie-break: only the tied candidates make another statement, then every living seat votes again until one candidate has a unique highest vote. Model and human actions go through the same game-module validation.

There is no standard fixed round count for the party game, and the public rules descriptions I found do not publish a 99.9th-percentile game-length statistic ([example overview](https://www.baike.com/wiki/%E8%B0%81%E6%98%AF%E5%8D%A7%E5%BA%95)). Under this app's rules, every unique top vote eliminates one seat. In the standard 4-seat/1-undercover, 5-seat/2-undercover, and 6-seat/2-undercover configurations, a game reaches a win condition within at most two unique eliminations. Even at 10 seats, the theoretical maximum is eight unique eliminations (one undercover can survive until only one civilian remains). Tied re-votes happen inside the same round and do not consume this limit. The configurable round cap now defaults to 20 and goes up to 99 as a guard for custom configurations; it does not prolong games that already meet a win condition.

The setup screen offers manual and randomly assigned model lineups. Random lineups balance selected profiles so their seat counts differ by at most one. Remainder seats go first to profiles with fewer historical seat appearances in random-lineup matches, with ties randomized. If there are more selected profiles than seats, the least-used profiles are preferred and no profile is duplicated in that match. Seat order is randomized. Participation counts increment once per model seat when a random-lineup match starts; manual lineups and unstarted setups do not count. Existing random-lineup matches initialize the counts, which persist independently of deletable match history. Role assignment is a separate game-level shuffle and does not depend on model identity, rating, or behavior. Only all-model Who's Undercover games using a random lineup and standard rules are rated: 4 seats / 1 undercover, 5 seats / 2 undercovers, or 6 seats / 2 undercovers. Manual lineups, games with human seats, and other configurations remain playable but do not change Elo.

For a rated game, team averages feed the standard Elo expectation formula with K=32. Each seat receives its faction's result delta; when a profile occupies seats in both factions, its change is the average across those seats. For example, in a four-seat game where model B has one civilian and one undercover seat, an undercover win gives B equal and opposite seat changes, while model A's civilian seats lose rating. B stays level for that game and moves ahead of A relative to it. Random role and model assignment reduces persistent seat-selection bias over repeated matches, but a single result still has role and game variance; this is not a role-win-rate-calibrated rating.

The first launch after this rating change starts a fresh Elo baseline because earlier matches did not record whether model placement was randomized. Old matches remain available as replays and are marked unranked.

The Who's Undercover module lives in `src/main/games/undercover/`: `index.ts` implements the rules and prompt, and `words.json` stores the civilian/undercover word pairs. Future game modules can use their own directories for source, JSON data, images, audio, and other imported assets. The prompt is in `undercoverGame.agentInstructions`; it explicitly names Who's Undercover and asks agents to conceal private information and use indirect clues without preassigning their role. Each seat's role and word still come from its private game observation. Theme selection is under Settings and is stored locally.

The app sends `reasoning_effort: "low"` with every Chat Completions request, including connection tests and match turns. This is an explicit request, not a guarantee that a model performs no reasoning; providers may interpret it differently or reject the parameter if their compatible endpoint does not support it. Elo is not split by reasoning effort. Within one match, a seat's model history carries across its turns; another seat or match receives a separate history.

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
