# Phase 2: Chain Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish direct communication with the Solana blockchain, Meteora DLMM SDK, Jupiter swap API, and Helius RPC.

**Architecture:** Use `@solana/web3.js` for base connection, `@meteora-ag/dlmm` to proxy pool queries, and `@jup-ag/api` for swapping base tokens efficiently.

**Tech Stack:** Bun, TypeScript, `@solana/web3.js`, `@meteora-ag/dlmm`, `@jup-ag/api`

---

### Task 1: Helius RPC Connection and Wallet Management

**Files:**
- Create: `src/chain/connection.ts`
- Create: `src/chain/wallet.ts`
- Create: `src/chain/chain.test.ts`

**Step 1: Write the failing test**

```typescript
// src/chain/chain.test.ts
import { expect, test } from "bun:test";
import { getConnection } from "./connection";
import { getWallet } from "./wallet";
import { Keypair } from "@solana/web3.js";

test("creates a valid RPC connection", () => {
    const conn = getConnection("https://api.mainnet-beta.solana.com");
    expect(conn.rpcEndpoint).toBe("https://api.mainnet-beta.solana.com");
});

test("generates or gets Wallet from env", () => {
    process.env.SOLANA_PRIVATE_KEY = Keypair.generate().secretKey.toString();
    const wallet = getWallet();
    expect(wallet.publicKey).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/chain/chain.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/chain/connection.ts
import { Connection } from "@solana/web3.js";

let connection: Connection | null = null;

export function getConnection(rpcUrl: string): Connection {
    if (!connection) {
        connection = new Connection(rpcUrl, {
            commitment: "confirmed",
            disableRetryOnRateLimit: false,
        });
    }
    return connection;
}
```

```typescript
// src/chain/wallet.ts
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

let wallet: Keypair | null = null;

export function getWallet(): Keypair {
    if (!wallet) {
        const privateKey = process.env.SOLANA_PRIVATE_KEY;
        if (!privateKey) throw new Error("SOLANA_PRIVATE_KEY is not set");

        try {
            wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
        } catch {
            const secretKeyArray = Uint8Array.from(JSON.parse(privateKey));
            wallet = Keypair.fromSecretKey(secretKeyArray);
        }
    }
    return wallet;
}
```

**Step 4: Run test to verify it passes**

Run: `bun install @solana/web3.js bs58`
Run: `bun add -d @types/bs58`
Run: `bun test src/chain/chain.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/chain/connection.ts src/chain/wallet.ts src/chain/chain.test.ts package.json bun.lockb
git commit -m "feat: implement solana connection and wallet managers"
```

---

### Task 2: DLMM Wrapper & Jupiter Hooks

**Files:**
- Create: `src/chain/dlmm.ts`
- Create: `src/chain/jupiter.ts`

**Step 1: Write the failing test**

```typescript
// src/chain/dlmm.test.ts
import { expect, test } from "bun:test";
import { getDlmmPool } from "./dlmm";
import { getJupiterQuote } from "./jupiter";
import { PublicKey } from "@solana/web3.js";

test("exports dlmm pool getter", () => {
    expect(typeof getDlmmPool).toBe("function");
});

test("exports jupiter tool", () => {
    expect(typeof getJupiterQuote).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/chain/dlmm.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/chain/dlmm.ts
import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey } from '@solana/web3.js';

export async function getDlmmPool(connection: Connection, poolAddress: string) {
    return await DLMM.create(connection, new PublicKey(poolAddress));
}
```

```typescript
// src/chain/jupiter.ts
import { DefaultApi, createConfiguration, QuoteGetRequest, QuoteResponse } from '@jup-ag/api';

const config = createConfiguration({ basePath: 'https://quote-api.jup.ag/v6' });
const jupiterApi = new DefaultApi(config);

export async function getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
): Promise<QuoteResponse> {
    const params: QuoteGetRequest = { inputMint, outputMint, amount, slippageBps };
    return await jupiterApi.quoteGet(params);
}
```

**Step 4: Run test to verify it passes**

Run: `bun install @meteora-ag/dlmm @jup-ag/api`
Run: `bun test src/chain/dlmm.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/chain/dlmm.ts src/chain/jupiter.ts src/chain/dlmm.test.ts package.json bun.lockb
git commit -m "feat: implement DLMM SDK wrapper and Jupiter API"
```