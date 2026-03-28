// src/memory/recall.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "./sqlite";
import { insertTrade } from "./trades";
import { insertPosition } from "./positions";
import { insertFeeClaim } from "./fees";
import { buildContext, contextToPromptString } from "./recall";

beforeAll(() => {
    initDb(":memory:");
    insertPosition({
        position_pubkey: "pos_recall",
        pool_address: "pool_recall",
        strategy_type: "bid_ask",
        bin_step: 100,
        min_bin: -10,
        max_bin: 10,
        amount_x: 0.5,
        amount_y: 1000,
        status: "open",
    });
    insertTrade({
        position_pubkey: "pos_recall",
        pool_address: "pool_recall",
        token_a: "SOL",
        token_b: "BONK",
        action: "open",
        amount_sol: 0.5,
        amount_token: 1000,
        tx_signature: "sig_recall",
    });
    insertFeeClaim({
        position_pubkey: "pos_recall",
        fee_a: 0.05,
        fee_b: 50,
        tx_signature: "fee_recall",
    });
});

afterAll(() => {
    closeDb();
});

test("buildContext returns wallet, positions, performance, and activity", async () => {
    const ctx = await buildContext("SCREENER", 2.5, { BONK: 500 });

    expect(ctx.wallet.solBalance).toBe(2.5);
    expect(ctx.wallet.tokenBalances.BONK).toBe(500);
    expect(ctx.positions.length).toBe(1);
    expect(ctx.positions[0].pool_address).toBe("pool_recall");
    expect(ctx.performance.totalFeesClaimedA).toBe(0.05);
    expect(ctx.performance.totalFeesClaimedB).toBe(50);
    expect(ctx.recentActivity.length).toBe(1);
    expect(ctx.recentActivity[0].action).toBe("open");
    // Qdrant may not be available, lessons can be empty
});

test("contextToPromptString formats readable output", async () => {
    const ctx = await buildContext("SCREENER", 1.0);
    const prompt = contextToPromptString(ctx);

    expect(prompt).toContain("Portfolio:");
    expect(prompt).toContain("1.0000 SOL");
    expect(prompt).toContain("pool_recall");
    expect(prompt).toContain("Performance:");
    expect(prompt).toContain("Recent Activity:");
});
