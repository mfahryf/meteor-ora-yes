# Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap the DLMM agent project with Bun, TypeScript, strict Zod config validation, structured logging, and local SQLite data tables.

**Architecture:** Uses Bun as the runtime and test runner. The configuration is validated strictly via Zod before the app starts to ensure all keys and constraints are met. We use `pino` for fast structured logging, and Bun's native `bun:sqlite` to initialize our structured memory layout.

**Tech Stack:** Bun, TypeScript, `zod`, `pino`, `bun:sqlite`

---

### Task 1: Project Initialization and Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/index.test.ts`

**Step 1: Write the failing test**

```typescript
// src/index.test.ts
import { expect, test } from "bun:test";
import { hello } from "./index";

test("hello returns greeting", () => {
  expect(hello()).toBe("DLMM Agent starting...");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/index.test.ts`
Expected: FAIL (Cannot find module './index')

**Step 3: Write minimal implementation**

```json
// package.json
{
  "name": "dlmm-agent",
  "module": "src/index.ts",
  "type": "module",
  "devDependencies": {
    "bun-types": "latest"
  },
  "dependencies": {
    "zod": "^3.22.4",
    "pino": "^8.19.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "module": "esnext",
    "target": "esnext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "composite": true,
    "strict": true,
    "downlevelIteration": true,
    "skipLibCheck": true,
    "jsx": "preserve",
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "allowJs": true,
    "types": [
      "bun-types"
    ]
  }
}
```

```typescript
// src/index.ts
export function hello() {
  return "DLMM Agent starting...";
}

if (import.meta.main) {
  console.log(hello());
}
```

**Step 4: Run test to verify it passes**

Run: `bun install`
Run: `bun test src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lockb src/index.ts src/index.test.ts
git commit -m "chore: initialize bun project and install foundation dependencies"
```

---

### Task 2: Configuration Schema Validation

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/schema.test.ts`

**Step 1: Write the failing test**

```typescript
// src/config/schema.test.ts
import { expect, test } from "bun:test";
import { ConfigSchema } from "./schema";

test("validates minimal valid config", () => {
  const rawConfig = {
    preset: "custom",
    credentials: {
      rpcUrl: "https://rpc.example.com",
      walletKey: "secret",
      heliusApiKey: "key",
      telegramBotToken: "token",
      telegramChatId: "id"
    },
    llm: {
      baseUrl: "https://api.openai.com",
      apiKey: "key",
      model: "gpt-4",
      managementModel: "gpt-4",
      screeningModel: "gpt-4",
      generalModel: "gpt-4",
      chatModel: "gpt-4",
      temperature: 0.3,
      maxTokens: 1000,
      maxSteps: 10
    },
    risk: { maxPositions: 3, maxDeployAmount: 0.5 },
    screening: {
      timeframe: "30m", category: "trending", minTvl: 10000, maxTvl: 100000,
      minVolume: 1000, minOrganic: 50, minHolders: 100, minMcap: 50000,
      maxMcap: 1000000, minBinStep: 80, maxBinStep: 125, minFeeActiveTvlRatio: 0.01,
      minTokenFeesSol: 10, maxBundlersPct: 20, maxTop10Pct: 50, blockedLaunchpads: []
    },
    management: {
      strategy: "bid_ask", binsBelow: 20, binsAbove: 20, deployAmountSol: 0.1,
      minSolToOpen: 0.1, gasReserve: 0.05, positionSizePct: 100, takeProfitFeePct: 5,
      emergencyPriceDropPct: -30, outOfRangeWaitMinutes: 20, outOfRangeBinsToClose: 10,
      minClaimAmount: 0.1, minVolumeToRebalance: 1000, minFeePerTvl24h: 0.05,
      autoSwapAfterClaim: true
    },
    telegram: {
      authorizedChatIds: ["id"], chatHistoryLimit: 20, approvalTimeoutMs: 300000,
      rateLimitPerSecond: 0.5, rateLimitPerHour: 100
    },
    schedule: {
      managementIntervalMin: 5, screeningIntervalMin: 30,
      evolutionIntervalHours: 6, healthCheckIntervalMin: 60
    },
    runtime: { dryRun: true, logLevel: "info" }
  };

  const result = ConfigSchema.safeParse(rawConfig);
  expect(result.success).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/config/schema.test.ts`
Expected: FAIL (Cannot find module './schema')

**Step 3: Write minimal implementation**

```typescript
// src/config/schema.ts
import { z } from 'zod';

export const ConfigSchema = z.object({
  preset: z.literal('custom'),
  credentials: z.object({
    rpcUrl: z.string().url(),
    walletKey: z.string(),
    heliusApiKey: z.string(),
    telegramBotToken: z.string(),
    telegramChatId: z.string(),
  }),
  llm: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string(),
    model: z.string(),
    managementModel: z.string(),
    screeningModel: z.string(),
    generalModel: z.string(),
    chatModel: z.string(),
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
    authorizedChatIds: z.array(z.string()),
    chatHistoryLimit: z.number().int().positive().default(20),
    approvalTimeoutMs: z.number().positive().default(300000),
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
  _lastEvolved: z.string().optional(),
  _lastAgentTune: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
```

**Step 4: Run test to verify it passes**

Run: `bun test src/config/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts src/config/schema.test.ts
git commit -m "feat: add Zod configuration schema"
```

---

### Task 3: Structured Logger

**Files:**
- Create: `src/utils/logger.ts`
- Create: `src/utils/logger.test.ts`

**Step 1: Write the failing test**

```typescript
// src/utils/logger.test.ts
import { expect, test } from "bun:test";
import { logger } from "./logger";

test("logger object exists and can log", () => {
  expect(logger).toBeDefined();
  expect(typeof logger.info).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/utils/logger.test.ts`
Expected: FAIL (Cannot find module './logger')

**Step 3: Write minimal implementation**

```typescript
// src/utils/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
});
```

*(Note: Install pino-pretty as a dev dependency to prevent runtime issues in local tests)*

```bash
bun add -d pino-pretty
```

**Step 4: Run test to verify it passes**

Run: `bun test src/utils/logger.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json bun.lockb src/utils/logger.ts src/utils/logger.test.ts
git commit -m "feat: add pino structured logger"
```

---

### Task 4: Local SQLite Database Setup

**Files:**
- Create: `src/memory/sqlite.ts`
- Create: `src/memory/sqlite.test.ts`

**Step 1: Write the failing test**

```typescript
// src/memory/sqlite.test.ts
import { expect, test, afterAll } from "bun:test";
import { initDb, db } from "./sqlite";

test("initializes database tables", () => {
  initDb(":memory:"); // Use in-memory DB for tests

  const tradesQuery = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='trades'");
  const result = tradesQuery.get() as any;

  expect(result.name).toBe("trades");
});

afterAll(() => {
  db.close();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/memory/sqlite.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/memory/sqlite.ts
import { Database } from "bun:sqlite";

export let db: Database;

export function initDb(path: string = "data/dlmm.db") {
  db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY,
        position_pubkey TEXT,
        pool_address TEXT,
        token_a TEXT,
        token_b TEXT,
        action TEXT,
        amount_sol REAL,
        amount_token REAL,
        tx_signature TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS positions (
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
        status TEXT
    );
    CREATE TABLE IF NOT EXISTS fee_claims (
        id INTEGER PRIMARY KEY,
        position_pubkey TEXT,
        fee_a REAL,
        fee_b REAL,
        tx_signature TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS config_log (
        id INTEGER PRIMARY KEY,
        key TEXT,
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        agent_type TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY,
        agent_type TEXT,
        goal TEXT,
        tools_called TEXT,
        final_answer TEXT,
        success BOOLEAN,
        duration_ms INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
        session_id TEXT PRIMARY KEY,
        message_history TEXT,
        context TEXT,
        created_at DATETIME,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_activity ON chat_sessions(last_activity);
  `);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/memory/sqlite.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/sqlite.ts src/memory/sqlite.test.ts
git commit -m "feat: initialize structured sqlite tables for memory"
```