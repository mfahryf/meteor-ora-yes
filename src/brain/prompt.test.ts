// src/brain/prompt.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { buildSystemPrompt, buildToolSchemas, type Role } from "./prompt";
import { initDb, closeDb } from "../memory/sqlite";
import { insertPosition } from "../memory/positions";
import type { AgentContext } from "../memory/recall";
import { defaultConfig } from "../config/defaults";

const mockContext: AgentContext = {
    wallet: { solBalance: 2.5, tokenBalances: { BONK: 5000 } },
    positions: [{
        position_pubkey: "test_pos",
        pool_address: "test_pool",
        strategy_type: "bid_ask",
        amount_x: 0.5,
        amount_y: 1000,
        status: "open",
    }],
    performance: { totalTrades: 12, totalFeesClaimedA: 0.5, totalFeesClaimedB: 200 },
    lessons: [{ id: "l1", text: "High TVL pools are safer", role: "SCREENER", pinned: true }],
    recentActivity: [{ action: "open", pool_address: "test_pool", amount_sol: 0.5, timestamp: "2026-03-27T12:00:00Z" }],
};

beforeAll(() => {
    initDb(":memory:");
    insertPosition({
        position_pubkey: "test_pos",
        pool_address: "test_pool",
        strategy_type: "bid_ask",
        bin_step: 100,
        min_bin: -10,
        max_bin: 10,
        amount_x: 0.5,
        amount_y: 1000,
        status: "open",
    });
});

afterAll(() => {
    closeDb();
});

test("buildSystemPrompt includes behavioral core", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("PATIENCE IS PROFIT");
    expect(prompt).toContain("GAS EFFICIENCY");
    expect(prompt).toContain("DATA-DRIVEN AUTONOMY");
    expect(prompt).toContain("POST-DEPLOY INTERVAL");
});

test("buildSystemPrompt includes timeframe scaling table", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("TIMEFRAME SCALING");
    expect(prompt).toContain("fee_active_tvl_ratio values are ALREADY in percentage form");
    expect(prompt).toContain(defaultConfig.screening.timeframe);
});

test("buildSystemPrompt includes current state section", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("CURRENT STATE");
    expect(prompt).toContain("2.5");
    expect(prompt).toContain("test_pool");
});

test("buildSystemPrompt includes lessons section", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("LESSONS LEARNED");
    expect(prompt).toContain("[PINNED]");
    expect(prompt).toContain("High TVL pools are safer");
});

test("buildSystemPrompt includes available tools", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("AVAILABLE TOOLS");
    expect(prompt).toContain("deploy_position");
});

test("SCREENER prompt includes all 10 screening steps", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("HARD SKIP if global_fees_sol");
    expect(prompt).toContain("CHOOSE STRATEGY based on token data");
    expect(prompt).toContain("CHOOSE RATIO");
    expect(prompt).toContain("CHOOSE BIN RANGE");
    expect(prompt).toContain("PRE-DEPLOY");
    expect(prompt).toContain("DEPLOY");
    expect(prompt).toContain("Pool age affects shape");
});

test("MANAGER prompt includes strategy-specific management rules", () => {
    const prompt = buildSystemPrompt("MANAGER", mockContext, defaultConfig);
    expect(prompt).toContain("INSTRUCTION CHECK");
    expect(prompt).toContain("STRATEGY CHECK");
    expect(prompt).toContain("single_sided_reseed");
    expect(prompt).toContain("fee_compounding");
    expect(prompt).toContain("partial_harvest");
    expect(prompt).toContain("BIAS TO HOLD");
    expect(prompt).toContain("OOR UPSIDE");
});

test("EVOLVER prompt includes analysis flow", () => {
    const prompt = buildSystemPrompt("EVOLVER", mockContext, defaultConfig);
    expect(prompt).toContain("ANALYSIS FLOW");
    expect(prompt).toContain("Pull Performance Data");
    expect(prompt).toContain("Analyze Patterns");
    expect(prompt).toContain("Propose Changes");
    expect(prompt).toContain("Save Lessons");
});

test("CHAT prompt includes override and parallel rules", () => {
    const prompt = buildSystemPrompt("CHAT", mockContext, defaultConfig);
    expect(prompt).toContain("OVERRIDE RULE");
    expect(prompt).toContain("SWAP AFTER CLOSE");
    expect(prompt).toContain("PARALLEL FETCH RULE");
    expect(prompt).toContain("do NOT ask for confirmation");
});

test("buildToolSchemas returns correct tools per role", () => {
    const screenerSchemas = buildToolSchemas("SCREENER");
    expect(screenerSchemas.length).toBeGreaterThan(0);
    expect(screenerSchemas[0].type).toBe("function");
    expect(screenerSchemas.some(s => s.function.name === "deploy_position")).toBe(true);

    const chatSchemas = buildToolSchemas("CHAT");
    expect(chatSchemas.length).toBeGreaterThan(screenerSchemas.length);
});

test("buildSystemPrompt includes timestamp", () => {
    const prompt = buildSystemPrompt("SCREENER", mockContext, defaultConfig);
    expect(prompt).toContain("Timestamp:");
    expect(prompt).toContain("202"); // year prefix
});
