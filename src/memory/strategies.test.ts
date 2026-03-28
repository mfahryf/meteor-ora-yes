// src/memory/strategies.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "./sqlite";
import { addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy, getActiveStrategy } from "./strategies";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("seeds 5 built-in strategies on init", () => {
    const strategies = listStrategies();
    expect(strategies.length).toBe(5);
    expect(strategies.some(s => s.name === "Custom Ratio Spot")).toBe(true);
    const active = getActiveStrategy();
    expect(active).not.toBeNull();
    expect(active!.name).toBe("Custom Ratio Spot");
});

test("addStrategy inserts a new strategy", () => {
    addStrategy({
        name: "test-strat",
        type: "custom_ratio_spot",
        description: "A test strategy",
        binRangeRules: { low: [20, 30] },
        directionalSplit: { flat: 0.5 },
        ratioRules: { neutral: [50, 50] },
        managementRules: { feeCompounding: true },
        active: false,
    });
    const strategies = listStrategies();
    expect(strategies.length).toBe(6);
    const found = strategies.find(s => s.name === "test-strat");
    expect(found).toBeDefined();
    expect(found!.type).toBe("custom_ratio_spot");
    expect(found!.binRangeRules).toEqual({ low: [20, 30] });
});

test("getStrategy returns strategy by name", () => {
    const s = getStrategy("test-strat");
    expect(s).not.toBeNull();
    expect(s!.name).toBe("test-strat");
    expect(s!.binRangeRules).toEqual({ low: [20, 30] });
});

test("getStrategy returns null for unknown", () => {
    expect(getStrategy("nonexistent")).toBeNull();
});

test("setActiveStrategy sets active flag", () => {
    addStrategy({ name: "strat-b", type: "bid_ask", description: "B", binRangeRules: {}, directionalSplit: {}, ratioRules: {}, managementRules: {}, active: false });
    setActiveStrategy("strat-b");
    const active = getActiveStrategy();
    expect(active).not.toBeNull();
    expect(active!.name).toBe("strat-b");
    expect(active!.active).toBe(true);
});

test("setActiveStrategy clears previous active", () => {
    setActiveStrategy("test-strat");
    expect(getActiveStrategy()!.name).toBe("test-strat");
    const b = getStrategy("strat-b");
    expect(b!.active).toBe(false);
});

test("removeStrategy deletes strategy", () => {
    const removed = removeStrategy("strat-b");
    expect(removed).toBe(true);
    expect(getStrategy("strat-b")).toBeNull();
});

test("removeStrategy returns false for missing", () => {
    expect(removeStrategy("nonexistent")).toBe(false);
});

test("addStrategy upserts on conflict", () => {
    addStrategy({ name: "upsert-test", type: "fee_compounding", description: "v1", binRangeRules: {}, directionalSplit: {}, ratioRules: {}, managementRules: {}, active: false });
    addStrategy({ name: "upsert-test", type: "partial_harvest", description: "v2", binRangeRules: {}, directionalSplit: {}, ratioRules: {}, managementRules: {}, active: false });
    const s = getStrategy("upsert-test");
    expect(s!.description).toBe("v2");
    expect(s!.type).toBe("partial_harvest");
});
