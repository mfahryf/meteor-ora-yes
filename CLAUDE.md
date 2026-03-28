# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run src/main.ts            # Start agent in TUI mode (default)
bun run src/main.ts --headless # Start agent headless (no TUI)
bun test                       # Run all tests
bun test src/path/to.test.ts   # Run a single test file
bunx tsc --noEmit              # Type-check without emitting
```

No scripts are defined in package.json — everything runs directly through Bun.

## Architecture

DLMM Agent is an autonomous Solana liquidity provision bot using Meteora DLMM pools. It runs a **ReAct loop** (Reason + Act) with parallel tool execution across four agent roles:

- **SCREENER** (30 min): Discovers pools, evaluates tokens, deploys liquidity
- **MANAGER** (5 min): Monitors positions, rebalances, claims fees, closes positions
- **EVOLVER** (6h): Analyzes performance, proposes strategy improvements
- **CHAT** (on-demand): Natural language interaction via Telegram or TUI

### Boot Flow

`src/main.ts` → `boot()` in `src/core/lifecycle.ts` → config load → SQLite → Qdrant → chain connection → tool registration → Telegram bot → schedule agent cycles

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/core/agent.ts` | ReAct loop — context building, LLM calls, tool execution |
| `src/core/lifecycle.ts` | Boot sequence, pause/resume, config getter |
| `src/core/commands.ts` | Shared `/command` handlers for TUI and Telegram |
| `src/core/scheduler.ts` | Interval-based job scheduler |
| `src/brain/` | LLM client (`llm.ts`), prompt builder (`prompt.ts`), response parser (`decision.ts`), role-specific prompts (`prompts/`) |
| `src/chain/` | Solana RPC (`connection.ts`), wallet (`wallet.ts`), Meteora DLMM SDK (`dlmm.ts`), Jupiter swap API (`jupiter.ts`), pool discovery (`scanner.ts`) |
| `src/strategy/` | Pool scoring (`screener.ts`), safety predicates (`risk.ts`), strategy types |
| `src/memory/` | SQLite (positions, trades, fees, strategies, blacklist, pool notes) + Qdrant (vector: lessons, outcomes, chat archives) |
| `src/tools/` | 30+ OpenAI function-calling tools (`definitions.ts`), registry, safety pre-flight checks, 5 built-in strategy compute functions |
| `src/telegram/` | Bot polling, command handlers, natural language chat, session management |
| `src/tui/` | Terminal-kit TUI: screen layout, log capture ring buffer, app controller |
| `src/config/` | Zod schema validation, defaults, config loader (JSON + env overrides) |

### Dual Memory

- **SQLite** (`bun:sqlite`): 11 tables — trades, positions, fee_claims, config_log, agent_runs, chat_sessions, strategies, blacklist, smart_wallets, pool_notes
- **Qdrant** (1536-dim Cosine): pool_outcomes, lessons, strategy_outcomes, chat_archives

### Tool System

All 30+ tools are OpenAI function-calling format in `src/tools/definitions.ts`. WRITE tools (deploy, close, swap) go through safety checks in `src/tools/safety.ts`. Tools are registered at boot via `src/tools/register.ts`.

### 5 Built-in Strategies

`custom_ratio_spot`, `single_sided_reseed`, `fee_compounding`, `multi_layer`, `partial_harvest` — computed in `src/tools/strategies.ts`.

## Key Patterns

- **Config**: Zod-validated schema with defaults, loaded from `config.json` with env var overrides. Env vars: `SOLANA_PRIVATE_KEY`, `HELIUS_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `QDRANT_URL`, `QDRANT_API_KEY`, `LOG_LEVEL`
- **LLM**: `openai` npm package with configurable `baseUrl`. Default model: `glm-5-turbo`. Different models configurable per role.
- **Singletons**: `getDb()` for SQLite, `getQdrant()` for Qdrant, `getConnection()` for Solana RPC, `getWallet()` for keypair
- **terminal-kit**: Import as `import { terminal as term } from "terminal-kit"` (named export, not default)
- **Logger**: Pino with custom stream supporting ring buffer capture for TUI mode. `setRingBuffer()` and `suppressStdoutForTui()` for TUI activation.
- **Commands**: Both TUI and Telegram use `dispatchCommand(name, ctx)` from `src/core/commands.ts` — single source of truth
- **Tests**: Use `bun:test` (Bun's built-in test runner). Tests use in-memory SQLite (`:memory:`). No mocks for DB — tests hit real SQLite.
