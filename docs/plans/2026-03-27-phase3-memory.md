# Phase 3: Memory Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the data access layers for historical trade/position structured logging and persistent memory.

**Architecture:** We use Bun's built-in sqlite to save and read structured trade/position data without an external DB process. For semantic recall (lessons), we will interface directly with Qdrant via its REST client.

**Tech Stack:** Bun SQLite, `uuid`, `@qdrant/js-client-rest`

---

### Task 1: SQLite Position Tracking

**Files:**
- Create: `src/memory/positions.ts`
- Create: `src/memory/positions.test.ts`

**Step 1: Write the failing test**

```typescript
// src/memory/positions.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, db } from "./sqlite";
import { insertPosition, getOpenPositions } from "./positions";

beforeAll(() => {
    initDb(":memory:");
});

afterAll(() => {
    db.close();
});

test("can insert and retrieve a position", () => {
    insertPosition({
        position_pubkey: "mock_pubkey_1",
        pool_address: "mock_pool",
        strategy_type: "spot",
        bin_step: 100,
        min_bin: -10,
        max_bin: 10,
        amount_x: 0.1,
        amount_y: 50.0,
        status: "open"
    });

    const open = getOpenPositions();
    expect(open.length).toBe(1);
    expect(open[0].position_pubkey).toBe("mock_pubkey_1");
    expect(open[0].status).toBe("open");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/memory/positions.test.ts`
Expected: FAIL (module not defined)

**Step 3: Write minimal implementation**

```typescript
// src/memory/positions.ts
import { db } from "./sqlite";

export interface PositionRecord {
    position_pubkey: string;
    pool_address: string;
    strategy_type: string;
    bin_step: number;
    min_bin: number;
    max_bin: number;
    amount_x: number;
    amount_y: number;
    status: string;
}

export function insertPosition(pos: PositionRecord) {
    const stmt = db.prepare(`
        INSERT INTO positions (
            position_pubkey, pool_address, strategy_type, bin_step,
            min_bin, max_bin, amount_x, amount_y, status, opened_at
        ) VALUES ($pubkey, $pool, $strat, $step, $min, $max, $amtx, $amty, $status, CURRENT_TIMESTAMP)
    `);

    stmt.run({
        $pubkey: pos.position_pubkey,
        $pool: pos.pool_address,
        $strat: pos.strategy_type,
        $step: pos.bin_step,
        $min: pos.min_bin,
        $max: pos.max_bin,
        $amtx: pos.amount_x,
        $amty: pos.amount_y,
        $status: pos.status
    });
}

export function getOpenPositions(): PositionRecord[] {
    const stmt = db.prepare(`SELECT * FROM positions WHERE status = 'open'`);
    return stmt.all() as PositionRecord[];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/memory/positions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/positions.ts src/memory/positions.test.ts
git commit -m "feat: implement SQLite position tracking"
```

---

### Task 2: Lessons Qdrant Interface

**Files:**
- Create: `src/memory/qdrant.ts`
- Create: `src/memory/qdrant.test.ts`

**Step 1: Write the failing test**

```typescript
// src/memory/qdrant.test.ts
import { expect, test } from "bun:test";
import { getQdrantClient } from "./qdrant";

test("initializes Qdrant client", () => {
    process.env.QDRANT_URL = "http://localhost:6333";
    process.env.QDRANT_API_KEY = "testkey";
    const client = getQdrantClient();

    expect(client).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/memory/qdrant.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/memory/qdrant.ts
import { QdrantClient } from '@qdrant/js-client-rest';

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
    if (!client) {
        client = new QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333',
            apiKey: process.env.QDRANT_API_KEY,
        });
    }
    return client;
}
```

**Step 4: Run test to verify it passes**

Run: `bun install @qdrant/js-client-rest`
Run: `bun test src/memory/qdrant.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/qdrant.ts src/memory/qdrant.test.ts package.json bun.lockb
git commit -m "feat: initialize Qdrant vector memory client"
```