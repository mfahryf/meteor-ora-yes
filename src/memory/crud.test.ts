// src/memory/crud.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb, getDb } from "./sqlite";
import { insertTrade, getTradesByPool, getRecentTrades } from "./trades";
import { insertPosition, getOpenPositions } from "./positions";
import { insertFeeClaim, getFeeClaimsByPosition, getTotalFeesClaimed } from "./fees";
import { insertAgentRun, getRecentRuns, getRunsByType } from "./runs";
import { insertConfigLog, getConfigHistory, getConfigHistoryForKey } from "./config-log";

beforeAll(() => {
    initDb(":memory:");
});

afterAll(() => {
    closeDb();
});

// --- Trades ---
test("insert and retrieve trades by pool", () => {
    insertTrade({
        position_pubkey: "pos1",
        pool_address: "poolA",
        token_a: "SOL",
        token_b: "BONK",
        action: "open",
        amount_sol: 0.1,
        amount_token: 5000,
        tx_signature: "sig1",
    });

    const trades = getTradesByPool("poolA");
    expect(trades.length).toBe(1);
    expect(trades[0].action).toBe("open");
    expect(trades[0].amount_sol).toBe(0.1);
});

test("getRecentTrades respects limit", () => {
    insertTrade({
        position_pubkey: "pos2", pool_address: "poolB", token_a: "SOL",
        token_b: "WIF", action: "open", amount_sol: 0.2, amount_token: 100, tx_signature: "sig2",
    });
    insertTrade({
        position_pubkey: "pos3", pool_address: "poolC", token_a: "SOL",
        token_b: "JUP", action: "open", amount_sol: 0.3, amount_token: 200, tx_signature: "sig3",
    });

    const recent = getRecentTrades(2);
    expect(recent.length).toBe(2);
});

// --- Fees ---
test("insert and retrieve fee claims", () => {
    insertFeeClaim({ position_pubkey: "pos1", fee_a: 0.01, fee_b: 100, tx_signature: "feeSig1" });
    insertFeeClaim({ position_pubkey: "pos1", fee_a: 0.02, fee_b: 200, tx_signature: "feeSig2" });

    const claims = getFeeClaimsByPosition("pos1");
    expect(claims.length).toBe(2);
    expect(claims.map(c => c.fee_a)).toContain(0.01);
    expect(claims.map(c => c.fee_a)).toContain(0.02);
});

test("getTotalFeesClaimed aggregates correctly", () => {
    const total = getTotalFeesClaimed();
    expect(total.totalFeeA).toBe(0.03); // 0.01 + 0.02
    expect(total.totalFeeB).toBe(300);   // 100 + 200
});

// --- Agent Runs ---
test("insert and query agent runs", () => {
    insertAgentRun({
        agent_type: "SCREENER",
        goal: "Find trending pools",
        tools_called: JSON.stringify(["discover_pools", "get_pool_detail"]),
        final_answer: "Found 3 candidates",
        success: true,
        duration_ms: 5200,
    });

    insertAgentRun({
        agent_type: "MANAGER",
        goal: "Check positions",
        tools_called: JSON.stringify(["get_my_positions"]),
        final_answer: "All positions healthy",
        success: true,
        duration_ms: 1200,
    });

    const all = getRecentRuns();
    expect(all.length).toBe(2);

    const screeners = getRunsByType("SCREENER");
    expect(screeners.length).toBe(1);
    expect(screeners[0].agent_type).toBe("SCREENER");
});

// --- Config Log ---
test("insert and query config history", () => {
    insertConfigLog({
        key: "screening.minTvl",
        old_value: "10000",
        new_value: "20000",
        reason: "Higher TVL reduces rug risk",
        agent_type: "EVOLVER",
    });

    insertConfigLog({
        key: "screening.minTvl",
        old_value: "20000",
        new_value: "15000",
        reason: "Lowered after analysis",
        agent_type: "EVOLVER",
    });

    const history = getConfigHistory();
    expect(history.length).toBe(2);

    const tvlHistory = getConfigHistoryForKey("screening.minTvl");
    expect(tvlHistory.length).toBe(2);
    expect(tvlHistory.map(h => h.new_value)).toContain("20000");
    expect(tvlHistory.map(h => h.new_value)).toContain("15000");
});

// --- Positions (close) ---
test("close position updates status", () => {
    insertPosition({
        position_pubkey: "pos_close_test",
        pool_address: "poolZ",
        strategy_type: "spot",
        bin_step: 100,
        min_bin: -5,
        max_bin: 5,
        amount_x: 0.1,
        amount_y: 100,
        status: "open",
    });

    const db = getDb();
    db.exec(`UPDATE positions SET status = 'closed', closed_at = CURRENT_TIMESTAMP, final_pnl = 0.05 WHERE position_pubkey = 'pos_close_test'`);

    const open = getOpenPositions().filter(p => p.position_pubkey === "pos_close_test");
    expect(open.length).toBe(0);

    const closed = db.query(`SELECT * FROM positions WHERE position_pubkey = 'pos_close_test'`).get() as any;
    expect(closed.status).toBe("closed");
    expect(closed.final_pnl).toBe(0.05);
});
