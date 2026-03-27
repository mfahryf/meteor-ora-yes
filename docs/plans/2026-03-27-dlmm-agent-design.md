# DLMM Autonomous Agent - Design Document

**Date:** 2026-03-27
**Status:** Draft
**Runtime:** Bun + TypeScript
**Target:** Meteora DLMM on Solana

---

## Overview

An autonomous DLMM liquidity management agent powered by LLM-based decision making with persistent memory. The system scans trending pools, deploys liquidity, manages positions, and evolves its strategy over time — all with Telegram oversight.

### Key Features

- **ReAct Agent Loop** — Reason + Act pattern with parallel tool execution
- **Role-Based Agents** — SCREENER (deploy), MANAGER (monitor), EVOLVER (learn), CHAT (conversational)
- **Dual Memory** — SQLite for structured data, Qdrant for semantic recall
- **Telegram Chat** — Natural language conversation + commands + interactive approvals
- **Self-Evolution** — Agent tunes its own config based on performance

---

## Section 1: Project Structure

```
dlmm/
├── src/
│   ├── index.ts                     # Boot sequence
│   ├── config/
│   │   ├── schema.ts                # Zod validation for all config
│   │   ├── defaults.ts              # Default values
│   │   └── loader.ts                # Load, merge, persist config
│   ├── core/
│   │   ├── agent.ts                 # ReAct agent loop
│   │   ├── scheduler.ts             # Interval manager for all cycles
│   │   ├── lifecycle.ts             # Startup, shutdown, graceful exit
│   │   └── roles.ts                 # Tool sets per role
│   ├── chain/
│   │   ├── connection.ts            # Helius RPC with retry/fallback
│   │   ├── wallet.ts                # Keypair from env, balance checks
│   │   ├── dlmm.ts                  # Meteora DLMM SDK wrapper
│   │   ├── jupiter.ts               # Jupiter swap via API
│   │   └── scanner.ts               # Pool discovery + Meteora API
│   ├── strategy/
│   │   ├── screener.ts              # Pool filtering logic
│   │   ├── executor.ts              # Position open/close/rebalance
│   │   ├── risk.ts                  # Safety checks (pre-flight)
│   │   └── types.ts                 # Action types, strategy enums
│   ├── brain/
│   │   ├── llm.ts                   # LLM client (OpenAI-compatible)
│   │   ├── prompt.ts                # System prompt builder per role
│   │   ├── decision.ts              # Parse & validate LLM actions
│   │   ├── evolver.ts               # Strategy evolution logic
│   │   └── prompts/
│   │       ├── screener.ts          # 10-step screening instructions
│   │       ├── manager.ts           # Position management rules
│   │       ├── evolver.ts           # Evolution analysis prompt
│   │       └── chat.ts              # Conversational prompt
│   ├── memory/
│   │   ├── sqlite.ts                # Trade log, PnL, config history
│   │   ├── qdrant.ts                # Vector client + collections
│   │   ├── lessons.ts               # Store/retrieve/pin lessons
│   │   └── recall.ts                # Merge SQLite + Qdrant for context
│   ├── tools/
│   │   ├── definitions.ts           # All tool schemas (OpenAI format)
│   │   ├── executor.ts              # Dispatch + safety + side effects
│   │   └── registry.ts              # Tool name → function mapping
│   ├── telegram/
│   │   ├── bot.ts                   # Grammy bot init
│   │   ├── commands.ts              # /status /pause /resume /config etc
│   │   ├── chat.ts                  # Natural language chat handler
│   │   ├── session.ts               # Conversation session management
│   │   ├── approvals.ts             # Inline keyboard approval flow
│   │   └── notify.ts                # Alert formatting
│   └── utils/
│       ├── logger.ts                # Structured logging (pino)
│       ├── retry.ts                 # Exponential backoff for RPC
│       └── format.ts                # SOL/token/time formatting
├── data/
│   └── dlmm.db                      # SQLite database (gitignored)
├── config.json                       # Runtime config (gitignored)
├── config.example.json               # Committed example
├── package.json
├── tsconfig.json
├── bunfig.toml
└── .env.example                      # Wallet key, API keys
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `@meteora-ag/dlmm` | DLMM pool interactions |
| `@solana/web3.js` | Solana RPC + transactions |
| `@jup-ag/api` | Jupiter swaps |
| `@qdrant/js-client-rest` | Vector memory |
| `grammy` | Telegram bot |
| `zod` | Schema validation |
| `pino` | Structured logging |
| `openai` | LLM client (OpenAI-compatible) |

---

## Section 2: System Flow

### Application Boot

```
index.ts
    │
    ├─► Load config.json → Validate with Zod schema
    ├─► Init wallet from env (SOLANA_PRIVATE_KEY)
    ├─► Init Helius RPC connection
    ├─► Init SQLite database (create tables if needed)
    ├─► Init Qdrant client (ensure collections exist)
    ├─► Init Telegram bot (register commands + chat handler)
    │
    └─► Start Scheduler
            │
            ├─► SCREENER cycle (every 30m)
            ├─► MANAGER cycle (every 5m)
            ├─► EVOLVER cycle (every 6h)
            └─► HEALTH check (every 60m)
```

### Agent Loop (ReAct Pattern)

```
agentLoop(goal, role, maxSteps, sessionHistory = [])
    │
    ├─► FETCH LIVE STATE (parallel)
    │       ├─ getWalletBalances()
    │       ├─ getMyPositions()
    │       ├─ getPerformanceSummary() ← SQLite
    │       ├─ getLessons(role) ← Qdrant
    │       └─ getStateSummary()
    │
    ├─► BUILD SYSTEM PROMPT
    │       ├─ Universal context (state, config)
    │       ├─ Role-specific instructions
    │       ├─ Lessons learned (pinned + recent)
    │       └─ Available tools (filtered by role)
    │
    └─► ReAct LOOP (max N steps)
            │
            ├─► Call LLM with messages + tools
            │
            ├─► Response has tool_calls?
            │       │
            │       YES ─► Execute ALL tools in parallel
            │       │       ├─ Safety check (if WRITE tool)
            │       │       ├─ Run tool function
            │       │       ├─ Side effects (Telegram, auto-swap)
            │       │       └─ Push result to messages[]
            │       │       └─► Loop back to LLM
            │       │
            │       NO ─► FINAL ANSWER → return
            │
            └─► Return { content, userMessage }
```

---

## Section 3: Agent Roles

### SCREENER (Every 30 min)

**Goal:** Find trending pools, evaluate them, deploy liquidity

**Tools Available:**
- `list_strategies`, `get_strategy`, `set_active_strategy`
- `get_top_candidates`, `discover_pools`, `search_pools`
- `get_pool_detail`, `get_pool_memory`, `add_pool_note`
- `get_token_info`, `get_token_holders`, `get_token_narrative`
- `check_smart_wallets_on_pool`
- `study_top_lpers`
- `get_active_bin`
- `deploy_position`
- `get_wallet_balance`, `swap_token`
- `update_config`, `add_to_blacklist`

**Decision Tree (10 Steps):**

```
1. list_strategies → get active strategy profile
2. get_top_candidates → ranked pool list
3. study_top_lpers(pool) → analyze smart LP behavior
4. get_pool_memory(pool) → check past experience with this pool
5. check_smart_wallets + get_token_holders (parallel)
   ⛔ HARD GATE: global_fees_sol < minTokenFeesSol → SKIP
6. get_token_info + get_token_narrative → evaluate token quality
7. LLM DECIDES: strategy type + bin range + token/SOL ratio
8. get_wallet_balance → swap_token if needed
9. get_active_bin → current price on-chain
10. deploy_position → open LP position
    └─ Safety checks: position limit, duplicate pool, balance
    └─ Telegram notification on success
    └─ update_config to adjust interval based on volatility
```

### MANAGER (Every 5 min)

**Goal:** Monitor open positions, rebalance/claim/close as needed

**Tools Available:**
- `list_strategies`, `get_strategy`
- `get_my_positions`, `get_position_pnl`
- `get_pool_detail`, `get_active_bin`
- `claim_fees`, `close_position`
- `withdraw_liquidity`, `add_liquidity`
- `swap_token`
- `set_position_note`, `add_pool_note`
- `update_config`

**Decision Logic (per position):**

```
For each open position:
    │
    ├─ get_position_pnl → current PnL, fees, TVL
    ├─ get_active_bin → in-range (IR) or out-of-range (OOR)?
    ├─ get_pool_detail → volume, fee/TVL health
    │
    └─ LLM EVALUATES:
            │
            ├─ OOR + PnL > takeProfitPct% → close_position
            ├─ OOR + waited > outOfRangeWaitMinutes → close_position
            ├─ Price drop > emergencyPriceDropPct% → EMERGENCY CLOSE
            ├─ Fees > minClaimAmount → claim_fees
            │
            ├─ Strategy: fee_compounding → claim → add_liquidity
            ├─ Strategy: single_sided_reseed → withdraw → re-add
            ├─ Strategy: partial_harvest → withdraw 50% if return >= 10%
            │
            └─ Otherwise → HOLD (bias to hold)

Side effects:
    ├─ close_position → auto-swap base token to SOL
    ├─ claim_fees (if autoSwapAfterClaim) → swap base to SOL
    └─ All actions → Telegram notification
```

### EVOLVER (Every 6h)

**Goal:** Analyze performance, propose strategy improvements

**Tools Available:**
- `get_performance_history`
- `list_lessons`
- `update_config`
- `add_lesson`

**Analysis Flow:**

```
1. Pull performance history from SQLite
2. Pull all lessons from Qdrant
3. Analyze patterns:
   ├─ Which pool profiles were profitable?
   ├─ Which screening filters missed good pools?
   ├─ Which strategy types performed best?
   ├─ Optimal bin ranges for different volatility levels?
   └─ Common reasons for losses?
4. LLM proposes config changes with reasoning
5. Telegram approval (inline keyboard):
   ├─ APPROVE → update_config + save lesson
   └─ REJECT → save rejection reason as lesson
```

### CHAT (On-demand via Telegram)

**Goal:** Natural language conversation with the agent — ask questions, give instructions, request actions

**Tools Available:** ALL tools (full access)

**Session Management:**

```
Telegram Message (non-command)
    │
    ├─► Check if user is authorized (chat_id whitelist)
    │
    ├─► Load or create session
    │       ├─ session_id: telegram_chat_id
    │       ├─ message_history: last N messages (configurable, default 20)
    │       ├─ created_at, last_activity
    │       └─ context: { pending_action, referenced_position, etc }
    │
    ├─► Append user message to history
    │
    ├─► agentLoop(userMessage, "CHAT", maxSteps, sessionHistory)
    │       │
    │       ├─ Full context injected (wallet, positions, lessons, config)
    │       ├─ All tools available
    │       └─ Can execute actions or just answer questions
    │
    ├─► Append assistant response to history
    │
    └─► Send response to Telegram
            ├─ Text message (markdown formatted)
            ├─ If action was taken → include action summary
            └─ If approval needed → inline keyboard
```

**Chat Capabilities:**

| User says... | Agent does... |
|--------------|---------------|
| "What's my PnL?" | Calls `get_my_positions` + `get_position_pnl`, summarizes |
| "How much SOL do I have?" | Calls `get_wallet_balance`, reports |
| "Why did you skip BONK pool?" | Queries memory, explains screening decision |
| "Close the TRUMP position" | Calls `close_position` after confirmation |
| "What did you learn this week?" | Queries lessons from Qdrant, summarizes |
| "Pause for 2 hours" | Calls `update_config`, schedules auto-resume |
| "Scan for new pools now" | Triggers immediate SCREENER cycle |
| "Show me the top pools right now" | Calls `get_top_candidates`, formats list |
| "Is WIF token safe?" | Calls `get_token_info` + `get_token_holders`, analyzes |
| "Add BONK to blacklist" | Calls `add_to_blacklist`, confirms |
| "What's your strategy for volatile tokens?" | Explains from config + lessons |

**Context Awareness:**

The chat agent has full context and can reference:
- Current wallet state
- Open positions with PnL
- Recent screening/management decisions
- Lessons learned
- Config history and reasons for changes

**Example Conversation:**

```
USER:  why did you close my BONK position earlier?

AGENT: I closed your BONK/SOL position at 14:32 UTC because:

       1. The position had been out-of-range (OOR) for 23 minutes
          (threshold: 20 minutes)
       2. PnL was +8.2% at time of close
       3. Pool volume had dropped 60% in the last hour

       Final return: +0.032 SOL ($5.12)
       Tx: 7xK2m... [link]

USER:  ok good call. can you watch for BONK again if volume picks up?

AGENT: Got it. I've added a note to prioritize BONK/SOL in the next
       screening cycle if:
       - 24h volume > $50K
       - TVL remains > $30K

       I'll notify you if I deploy there again.

USER:  thanks. what's my total PnL this week?

AGENT: Your performance summary (last 7 days):

       | Metric         | Value          |
       |----------------|----------------|
       | Total Trades   | 12 (8 wins)    |
       | Total PnL      | +0.87 SOL      |
       | Win Rate       | 66.7%          |
       | Avg Hold Time  | 4.2 hours      |
       | Best Trade     | WIF/SOL +18%   |
       | Worst Trade    | PEPE/SOL -6%   |

       Net profit: +$139.20 USD
```

**Session Storage (SQLite):**

```sql
CREATE TABLE chat_sessions (
    session_id TEXT PRIMARY KEY,  -- telegram chat_id
    message_history TEXT,          -- JSON array of messages
    context TEXT,                  -- JSON object for ad-hoc context
    created_at DATETIME,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for cleanup of old sessions
CREATE INDEX idx_chat_sessions_last_activity ON chat_sessions(last_activity);
```

**Session Cleanup:** Sessions inactive for > 24h are archived to Qdrant for future reference, then cleared from SQLite.

---

## Section 4: Memory Architecture

### SQLite (Structured Data)

**Tables:**

```sql
-- Trade history
CREATE TABLE trades (
    id INTEGER PRIMARY KEY,
    position_pubkey TEXT,
    pool_address TEXT,
    token_a TEXT,
    token_b TEXT,
    action TEXT, -- 'open', 'close', 'add', 'withdraw', 'claim'
    amount_sol REAL,
    amount_token REAL,
    tx_signature TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Position tracking
CREATE TABLE positions (
    position_pubkey TEXT PRIMARY KEY,
    pool_address TEXT,
    strategy_type TEXT,
    bin_step INTEGER,
    min_bin INTEGER,
    max_bin INTEGER,
    amount_x REAL,
    amount_y REAL,
    opened_at DATETIME,
    closed_at DATETIME,
    final_pnl REAL,
    status TEXT -- 'open', 'closed'
);

-- Fee claims
CREATE TABLE fee_claims (
    id INTEGER PRIMARY KEY,
    position_pubkey TEXT,
    fee_a REAL,
    fee_b REAL,
    tx_signature TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Config change history
CREATE TABLE config_log (
    id INTEGER PRIMARY KEY,
    key TEXT,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    agent_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent run logs
CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY,
    agent_type TEXT,
    goal TEXT,
    tools_called TEXT, -- JSON array
    final_answer TEXT,
    success BOOLEAN,
    duration_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat sessions
CREATE TABLE chat_sessions (
    session_id TEXT PRIMARY KEY,
    message_history TEXT,
    context TEXT,
    created_at DATETIME,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Qdrant (Vector Memory)

**Collections:**

| Collection | Purpose | Vector Content |
|------------|---------|----------------|
| `pool_outcomes` | Pool profile → result mapping | Token metadata + pool metrics + outcome |
| `lessons` | Persistent lessons by role | Lesson text + tags (SCREENER/MANAGER/EVOLVER/CHAT) |
| `strategy_outcomes` | Strategy config + market → performance | Strategy params + market conditions |
| `chat_archives` | Archived chat sessions | Conversation summary + context |

**Usage:**

```typescript
// When evaluating a new pool
const similar = await qdrant.search('pool_outcomes', {
    vector: await embed(poolProfile),
    filter: { must: [{ key: 'profitable', value: true }] },
    limit: 5
});
// Returns: "This pool is similar to BONK/SOL where you made +12%"

// When LLM learns a lesson
await qdrant.upsert('lessons', {
    id: uuid(),
    vector: await embed(lessonText),
    payload: {
        text: lessonText,
        role: 'SCREENER',
        pinned: false,
        created_at: new Date().toISOString()
    }
});
```

---

## Section 5: Tool Definitions

### Tool Categories

**Screening (discovery):**
- `discover_pools` — Meteora Discovery API with filters
- `get_top_candidates` — Pre-scored, pre-filtered top N pools
- `get_pool_detail` — Single pool deep dive
- `search_pools` — Search by token symbol or CA

**Position Management:**
- `deploy_position` — Open LP position (WRITE)
- `close_position` — Full withdrawal + close (WRITE)
- `claim_fees` — Claim accumulated fees (WRITE)
- `withdraw_liquidity` — Partial/full withdraw (WRITE)
- `add_liquidity` — Add to existing position (WRITE)
- `get_position_pnl` — PnL + real-time metrics
- `get_my_positions` — All open positions

**Wallet:**
- `get_wallet_balance` — SOL/token balances
- `swap_token` — Jupiter swap (WRITE)

**Token Research:**
- `get_token_info` — Organic score, holders, mcap
- `get_token_holders` — Top 100 distribution + global_fees_sol
- `get_token_narrative` — Origin/catalyst info

**Smart Wallets:**
- `check_smart_wallets_on_pool`
- `add_smart_wallet`, `remove_smart_wallet`, `list_smart_wallets`

**Memory & Learning:**
- `add_lesson`, `list_lessons`, `pin_lesson`, `unpin_lesson`
- `set_position_note` — Persistent instruction on position
- `add_pool_note`, `get_pool_memory` — Per-pool annotation
- `get_performance_history`

**Strategy Library:**
- `add_strategy`, `list_strategies`, `get_strategy`
- `set_active_strategy`, `remove_strategy`

**Blacklist:**
- `add_to_blacklist`, `remove_from_blacklist`, `list_blacklist`

**Self-Management:**
- `update_config` — Runtime config mutation
- `self_update` — git pull + restart (optional)

**Top LPers:**
- `get_top_lpers` — Read-only lookup
- `study_top_lpers` — Deep analysis + lesson extraction

### Safety Checks (Pre-flight for WRITE tools)

Only enforced on `deploy_position`:

```typescript
async function runSafetyChecks(toolName: string, args: any): Promise<SafetyResult> {
    if (toolName === 'deploy_position') {
        // 1. Bin step within config range
        if (args.bin_step < config.screening.minBinStep ||
            args.bin_step > config.screening.maxBinStep) {
            return { blocked: true, reason: `Bin step ${args.bin_step} outside allowed range` };
        }

        // 2. Position count limit
        const positions = await getMyPositions();
        if (positions.length >= config.risk.maxPositions) {
            return { blocked: true, reason: `Max positions (${config.risk.maxPositions}) reached` };
        }

        // 3. No duplicate pool (unless explicitly allowed)
        if (!args.allow_duplicate_pool && positions.some(p => p.poolAddress === args.pool_address)) {
            return { blocked: true, reason: 'Position already exists in this pool' };
        }

        // 4. No duplicate base token across pools
        const baseToken = args.token_b;
        if (positions.some(p => p.tokenB === baseToken)) {
            return { blocked: true, reason: `Already have position in ${baseToken}` };
        }

        // 5. Balance check
        const balance = await getWalletBalance();
        const amountNeeded = args.amount_sol + config.management.gasReserve;
        if (balance.sol < amountNeeded) {
            return { blocked: true, reason: `Insufficient balance: ${balance.sol} < ${amountNeeded}` };
        }
    }

    return { pass: true };
}
```

---

## Section 6: Telegram Integration

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TELEGRAM BOT LAYER                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Commands    │  │    Chat      │  │  Approvals   │         │
│  │  (/status)   │  │  (natural    │  │  (inline     │         │
│  │              │  │   language)  │  │   keyboard)  │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │                                    │
│                    ┌──────▼──────┐                             │
│                    │   Session   │                             │
│                    │   Manager   │                             │
│                    │  (SQLite)   │                             │
│                    └──────┬──────┘                             │
│                           │                                    │
└───────────────────────────┼────────────────────────────────────┘
                            │
                     ┌──────▼──────┐
                     │  Agent Loop │
                     │  (CHAT role)│
                     └─────────────┘
```

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot, show welcome + capabilities |
| `/status` | Show positions, PnL, wallet balance |
| `/pause` | Pause all agent cycles |
| `/resume` | Resume agent cycles |
| `/exit-all` | Close all positions (requires confirmation) |
| `/force-scan` | Trigger immediate SCREENER cycle |
| `/config <key> <value>` | Update config value |
| `/config get <key>` | Show current config value |
| `/lessons` | List recent lessons |
| `/blacklist <token>` | Add token to blacklist |
| `/clear` | Clear chat history / start fresh conversation |
| `/help` | Show available commands + chat examples |

### Natural Language Chat

**How it works:**

1. Any non-command message is treated as a chat message
2. Message is passed to the CHAT agent with full context
3. Agent can:
   - Answer questions (read-only)
   - Execute actions (with approval for risky operations)
   - Remember conversation context for follow-up questions

**Example interactions:**

```
USER:  what's my portfolio looking like?

BOT:  📊 Portfolio Summary

      💰 Wallet Balance: 2.45 SOL ($392)

      📈 Open Positions (2):
      ├─ BONK/SOL
      │  Amount: 0.4 SOL | PnL: +12.3% | Fees: 0.02 SOL
      │  Status: In-range | Strategy: bid_ask
      │
      └─ WIF/SOL
         Amount: 0.3 SOL | PnL: -2.1% | Fees:  0.01 SOL
         Status: OOR (5 min) | Strategy: spot

      Total PnL: +$18.40

USER:  close the WIF one, it's been out of range for a while

BOT:  ⚠️ Confirm Close Position

      Pool: WIF/SOL
      PnL: -2.1% (-$6.72)
      Fees earned: 0.01 SOL ($1.60)
      Net result: -$5.12

      [✅ Confirm] [❌ Cancel]

USER:  [✅ Confirm]

BOT:  ✅ Position closed

      Withdrawn: 0.29 SOL + 1,234 WIF
      Fees claimed: 0.01 SOL
      Tx: 7xK2m... [view]

      WIF has been swapped to 0.012 SOL
      New balance: 2.47 SOL
```

### Interactive Approvals

**Triggers:**
- EVOLVER proposes config changes
- High-risk deploy (new token, low mcap, high volatility)
- `/exit-all` command
- Chat-initiated close/deploy actions

**Approval Types:**

| Type | Timeout | Auto-action |
|------|---------|-------------|
| Config change (EVOLVER) | 10 min | Reject if no response |
| Single position close | 3 min | Execute if no response |
| Deploy to new pool | 5 min | Reject if no response |
| Exit-all positions | 5 min | Reject if no response |

**Flow:**

```
BOT: "EVOLVER proposes:
      Raise minTvl from $15K to $20K

      Reasoning: Analysis of last 50 positions shows
      pools under $20K TVL had 3x higher rug rate.

      [✅ Approve] [❌ Reject] [🔄 Defer 1h]"

USER: [✅ Approve]

BOT: "✅ Applied. Saved as lesson:
      'Raising minTvl to $20K reduces rug risk'"
```

### Session Management

```typescript
interface ChatSession {
  sessionId: string;        // telegram chat_id
  messageHistory: Message[]; // last N messages (default 20)
  context: {
    pendingAction?: Action;
    referencedPosition?: string;
    userPreferences?: Record<string, any>;
  };
  createdAt: Date;
  lastActivity: Date;
}

// Session operations
- loadSession(chatId): ChatSession
- saveSession(session): void
- clearSession(chatId): void
- archiveSession(chatId): void  // to Qdrant for long-term memory
```

### Rate Limiting

- Max 1 message per 2 seconds per user
- Max 100 messages per hour per user
- Commands bypass rate limit

---

## Section 7: Config Schema

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
    preset: z.literal('custom'),

    credentials: z.object({
        rpcUrl: z.string().url(),
        walletKey: z.string(), // env var: SOLANA_PRIVATE_KEY
        heliusApiKey: z.string(),
        telegramBotToken: z.string(), // env var: TELEGRAM_BOT_TOKEN
        telegramChatId: z.string(), // env var: TELEGRAM_CHAT_ID
    }),

    llm: z.object({
        baseUrl: z.string().url(),
        apiKey: z.string(), // env var: LLM_API_KEY
        model: z.string(),
        managementModel: z.string(),
        screeningModel: z.string(),
        generalModel: z.string(),
        chatModel: z.string(),      // Model for chat role
        temperature: z.number().min(0).max(2),
        maxTokens: z.number().positive(),
        maxSteps: z.number().positive(),
    }),

    risk: z.object({
        maxPositions: z.number().int().positive(),
        maxDeployAmount: z.number().positive(),
    }),

    screening: z.object({
        timeframe: z.enum(['5m', '15m', '30m', '1h', '4h', '24h']),
        category: z.enum(['trending', 'new', 'volume']),
        minTvl: z.number().positive(),
        maxTvl: z.number().positive(),
        minVolume: z.number().positive(),
        minOrganic: z.number().min(0).max(100),
        minHolders: z.number().int().positive(),
        minMcap: z.number().positive(),
        maxMcap: z.number().positive(),
        minBinStep: z.number().int().positive(),
        maxBinStep: z.number().int().positive(),
        minFeeActiveTvlRatio: z.number().positive(),
        minTokenFeesSol: z.number().positive(),
        maxBundlersPct: z.number().min(0).max(100),
        maxTop10Pct: z.number().min(0).max(100),
        blockedLaunchpads: z.array(z.string()),
    }),

    management: z.object({
        strategy: z.enum(['spot', 'curve', 'bid_ask', 'single_sided_reseed', 'fee_compounding', 'partial_harvest']),
        binsBelow: z.number().int().positive(),
        binsAbove: z.number().int().positive(),
        deployAmountSol: z.number().positive(),
        minSolToOpen: z.number().positive(),
        gasReserve: z.number().positive(),
        positionSizePct: z.number().min(0).max(100),
        takeProfitFeePct: z.number().positive(),
        emergencyPriceDropPct: z.number().negative(),
        outOfRangeWaitMinutes: z.number().int().positive(),
        outOfRangeBinsToClose: z.number().int().positive(),
        minClaimAmount: z.number().positive(),
        minVolumeToRebalance: z.number().positive(),
        minFeePerTvl24h: z.number().positive(),
        autoSwapAfterClaim: z.boolean(),
    }),

    telegram: z.object({
        authorizedChatIds: z.array(z.string()),  // Whitelist of allowed chat IDs
        chatHistoryLimit: z.number().int().positive().default(20),
        approvalTimeoutMs: z.number().positive().default(300000),  // 5 min
        rateLimitPerSecond: z.number().positive().default(0.5),
        rateLimitPerHour: z.number().int().positive().default(100),
    }),

    schedule: z.object({
        managementIntervalMin: z.number().positive(),
        screeningIntervalMin: z.number().positive(),
        evolutionIntervalHours: z.number().positive(),
        healthCheckIntervalMin: z.number().positive(),
    }),

    runtime: z.object({
        dryRun: z.boolean(),
        logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
    }),

    // Runtime metadata (not in config file)
    _lastEvolved: z.string().optional(),
    _lastAgentTune: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
```

---

## Section 8: Implementation Phases

### Phase 1: Foundation
- [ ] Project setup (bun init, tsconfig, package.json)
- [ ] Config schema + loader
- [ ] Logger + utils
- [ ] Helius connection + wallet
- [ ] SQLite setup + migrations

### Phase 2: Chain Layer
- [ ] Meteora DLMM wrapper
- [ ] Jupiter swap integration
- [ ] Pool scanner (Meteora API)

### Phase 3: Memory
- [ ] SQLite operations
- [ ] Qdrant client + collections
- [ ] Lessons storage/retrieval
- [ ] Recall merger

### Phase 4: Tools
- [ ] Tool definitions (OpenAI format)
- [ ] Tool registry
- [ ] Executor + safety checks

### Phase 5: Brain
- [ ] LLM client
- [ ] Prompt builder per role
- [ ] ReAct agent loop
- [ ] Evolver logic

### Phase 6: Strategy
- [ ] Screener logic
- [ ] Position executor
- [ ] Risk guardrails

### Phase 7: Telegram
- [ ] Grammy bot setup
- [ ] Commands handler
- [ ] Chat handler (natural language)
- [ ] Session management
- [ ] Approvals flow
- [ ] Notifications

### Phase 8: Core
- [ ] Scheduler
- [ ] Lifecycle management
- [ ] Health checks

### Phase 9: Testing & Polish
- [ ] Unit tests
- [ ] Integration tests
- [ ] Dry run mode
- [ ] Documentation

---

## Appendix A: Environment Variables

```bash
# .env.example

# Solana
SOLANA_PRIVATE_KEY=your_base58_private_key

# RPC
HELIUS_API_KEY=your_helius_api_key

# LLM
LLM_API_KEY=your_llm_api_key

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Qdrant (optional, defaults to local)
QDRANT_URL=https://your-qdrant-instance
QDRANT_API_KEY=your_qdrant_api_key
```

---

## Appendix B: Sample Config

See `config.example.json` in project root.

---

## References

- [Meteora DLMM SDK](https://github.com/MeteoraAg/dlmm-sdk)
- [Jupiter API](https://station.jup.ag/docs/)
- [Helius RPC](https://docs.helius.dev/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Grammy Telegram Framework](https://grammy.dev/)
