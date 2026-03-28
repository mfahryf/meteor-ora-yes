// src/tools/safety.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { runSafetyChecks } from "./safety";
import { initDb, closeDb } from "../memory/sqlite";
import type { Config } from "../config/schema";

const mockConfig = {
    screening: { minBinStep: 10, maxBinStep: 125 },
    risk: { maxPositions: 3, maxDeployAmount: 0.5 },
    management: { gasReserve: 0.05 },
} as any as Config;

beforeAll(() => {
    initDb(":memory:");
});

afterAll(() => {
    closeDb();
});

test("allows valid deploy", async () => {
    const result = await runSafetyChecks("deploy_position", {
        pool_address: "new_pool",
        bin_step: 100,
        amount_sol: 0.3,
    }, mockConfig, 1.0);

    expect(result.blocked).toBe(false);
});

test("blocks bin step outside range", async () => {
    const result = await runSafetyChecks("deploy_position", {
        pool_address: "pool1",
        bin_step: 200,
        amount_sol: 0.1,
    }, mockConfig, 1.0);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Bin step");
});

test("blocks insufficient balance", async () => {
    const result = await runSafetyChecks("deploy_position", {
        pool_address: "pool2",
        bin_step: 50,
        amount_sol: 0.5,
    }, mockConfig, 0.01);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Insufficient balance");
});

test("blocks amount exceeding max deploy", async () => {
    const result = await runSafetyChecks("deploy_position", {
        pool_address: "pool3",
        bin_step: 50,
        amount_sol: 1.0,
    }, mockConfig, 5.0);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("exceeds max");
});

test("passes for valid swap", async () => {
    const result = await runSafetyChecks("swap_token", {
        input_mint: "So11111111111111111111111111111111111111112",
        output_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: 1000000,
    }, mockConfig, 0);
    expect(result.blocked).toBe(false);
});

test("blocks swap with missing mints", async () => {
    const result = await runSafetyChecks("swap_token", {}, mockConfig, 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Missing");
});

test("passes for unknown tools", async () => {
    const result = await runSafetyChecks("some_read_tool", {}, mockConfig, 0);
    expect(result.blocked).toBe(false);
});
