# Phase 6: Strategy Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide structural guardrails including Risk parameters and shared types to ensure deployments adhere strictly to limits and conditions.

**Architecture:** Pure algorithmic guardrails evaluating state arrays vs config specifications prior to Tool execution.

**Tech Stack:** Bun, TypeScript

---

### Task 1: Risk Assessment Guardrails

**Files:**
- Create: `src/strategy/risk.ts`
- Create: `src/strategy/risk.test.ts`

**Step 1: Write the failing test**

```typescript
// src/strategy/risk.test.ts
import { expect, test } from "bun:test";
import { isUnderPositionLimit, isSafeToDeploy } from "./risk";

test("enforces max position limit", () => {
    const openPositionsCount = 3;
    const limit = 3;
    expect(isUnderPositionLimit(openPositionsCount, limit)).toBe(false);
    expect(isUnderPositionLimit(1, limit)).toBe(true);
});

test("enforces minimum balance for deployment", () => {
    const balance = 0.5;
    const requested = 0.4;
    const gasReserve = 0.1;
    const gasReserveHigh = 0.2;
    expect(isSafeToDeploy(balance, requested, gasReserve)).toBe(true);
    expect(isSafeToDeploy(balance, requested, gasReserveHigh)).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/strategy/risk.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/strategy/risk.ts

export function isUnderPositionLimit(currentCount: number, limit: number): boolean {
    return currentCount < limit;
}

export function isSafeToDeploy(
    currentBalance: number,
    requestedAmount: number,
    minGasReserve: number
): boolean {
    return currentBalance >= (requestedAmount + minGasReserve);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/strategy/risk.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategy/risk.ts src/strategy/risk.test.ts
git commit -m "feat: implement strategy risk guardrails"
```