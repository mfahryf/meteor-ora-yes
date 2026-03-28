// src/strategy/risk.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "../memory/sqlite";
import { insertPosition } from "../memory/positions";
import {
    isUnderPositionLimit,
    isSafeToDeploy,
    isWithinBinStepRange,
    isNotDuplicatePool,
    passesGlobalFeesGate,
} from "./risk";
import type { Config } from "../config/schema";
import { defaultConfig } from "../config/defaults";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("isUnderPositionLimit returns false at limit", () => {
    insertPosition({
        position_pubkey: "p1", pool_address: "poolA", strategy_type: "spot",
        bin_step: 100, min_bin: -5, max_bin: 5, amount_x: 0.1, amount_y: 50, status: "open",
    });
    insertPosition({
        position_pubkey: "p2", pool_address: "poolB", strategy_type: "spot",
        bin_step: 80, min_bin: -5, max_bin: 5, amount_x: 0.1, amount_y: 50, status: "open",
    });
    insertPosition({
        position_pubkey: "p3", pool_address: "poolC", strategy_type: "spot",
        bin_step: 50, min_bin: -5, max_bin: 5, amount_x: 0.1, amount_y: 50, status: "open",
    });

    const config = { ...defaultConfig, risk: { ...defaultConfig.risk, maxPositions: 3 } } as Config;
    expect(isUnderPositionLimit(config)).toBe(false);
});

test("isUnderPositionLimit returns true under limit", () => {
    closeDb();
    initDb(":memory:");
    const config = { ...defaultConfig, risk: { maxPositions: 5 } } as Config;
    expect(isUnderPositionLimit(config)).toBe(true);
});

test("isSafeToDeploy checks balance + gas reserve", () => {
    expect(isSafeToDeploy(1.0, 0.5, 0.1)).toBe(true);
    expect(isSafeToDeploy(0.5, 0.5, 0.2)).toBe(false); // 0.5 + 0.2 = 0.7 > 0.5
    expect(isSafeToDeploy(1.0, 0.5, 0.5)).toBe(true);  // exactly enough
});

test("isWithinBinStepRange validates correctly", () => {
    expect(isWithinBinStepRange(100, 80, 125)).toBe(true);
    expect(isWithinBinStepRange(50, 80, 125)).toBe(false);
    expect(isWithinBinStepRange(130, 80, 125)).toBe(false);
});

test("isNotDuplicatePool detects duplicates", () => {
    const positions = [
        { pool_address: "poolA", strategy_type: "spot", bin_step: 100, min_bin: -5, max_bin: 5, amount_x: 0.1, amount_y: 50, position_pubkey: "p1", status: "open" },
        { pool_address: "poolB", strategy_type: "spot", bin_step: 80, min_bin: -5, max_bin: 5, amount_x: 0.1, amount_y: 50, position_pubkey: "p2", status: "open" },
    ];
    expect(isNotDuplicatePool("poolA", positions)).toBe(false);
    expect(isNotDuplicatePool("poolC", positions)).toBe(true);
});

test("passesGlobalFeesGate enforces minimum fees", () => {
    expect(passesGlobalFeesGate(30, 30)).toBe(true);
    expect(passesGlobalFeesGate(29.9, 30)).toBe(false);
    expect(passesGlobalFeesGate(50, 30)).toBe(true);
});
