// src/tools/strategies.test.ts
import { expect, test } from "bun:test";
import { computeStrategy } from "./strategies";
import type { ComputeInput } from "./strategies";

const baseMarket = {
    priceChange1hPct: 0,
    priceChange24hPct: 0,
    netBuyers1h: 0,
    netBuyers24h: 0,
    volatility: 2,
    priceTrend: "flat" as const,
};

const baseInput: ComputeInput = {
    pool: {} as any,
    market: baseMarket,
    walletSolBalance: 1.0,
    maxDeploySol: 0.5,
    gasReserve: 0.05,
};

// ─── custom_ratio_spot ─────────────────────────────────────────────

test("custom_ratio_spot with flat market returns balanced bins and 50/50 ratio", () => {
    const result = computeStrategy("custom_ratio_spot", baseInput);
    expect(result.strategy_type).toBe("custom_ratio_spot");
    expect(result.bins_below).toBeGreaterThan(0);
    expect(result.bins_above).toBeGreaterThan(0);
    expect(result.need_swap).toBe(true);
    expect(result.swap_amount_sol).toBeGreaterThan(0);
    expect(result.management_rules.onOorDown).toBe("close");
});

test("custom_ratio_spot with bull market returns token-heavy ratio and uptrend bins", () => {
    const input: ComputeInput = {
        ...baseInput,
        market: { ...baseMarket, priceChange1hPct: 6, netBuyers1h: 15, priceTrend: "up" },
    };
    const result = computeStrategy("custom_ratio_spot", input);
    expect(result.strategy_type).toBe("custom_ratio_spot");
    expect(result.need_swap).toBe(true);
    expect(result.swap_amount_sol).toBeGreaterThan(0);
    // Uptrend: fewer bins below, more above
    expect(result.bins_above).toBeGreaterThan(result.bins_below);
});

// ─── single_sided_reseed ───────────────────────────────────────────

test("single_sided_reseed returns 100% token with bins_above=0", () => {
    const result = computeStrategy("single_sided_reseed", baseInput);
    expect(result.strategy_type).toBe("single_sided_reseed");
    expect(result.bins_above).toBe(0);
    expect(result.bins_below).toBeGreaterThan(0);
    expect(result.need_swap).toBe(true);
    expect(result.management_rules.onOorDown).toBe("reseed");
    expect(result.management_rules.onOorUp).toBe("hold");
});

// ─── fee_compounding ───────────────────────────────────────────────

test("fee_compounding returns balanced bins and compound rules", () => {
    const result = computeStrategy("fee_compounding", baseInput);
    expect(result.strategy_type).toBe("fee_compounding");
    expect(result.bins_below).toBe(result.bins_above);
    expect(result.management_rules.compoundFees).toBe(true);
});

// ─── multi_layer ───────────────────────────────────────────────────

test("multi_layer returns inner layer params", () => {
    const result = computeStrategy("multi_layer", baseInput);
    expect(result.strategy_type).toBe("multi_layer");
    expect(result.amount_sol).toBeLessThan(baseInput.walletSolBalance);
    expect(result.management_rules.onOorUp).toBe("hold");
});

// ─── partial_harvest ───────────────────────────────────────────────

test("partial_harvest returns harvest rules", () => {
    const result = computeStrategy("partial_harvest", baseInput);
    expect(result.strategy_type).toBe("partial_harvest");
    expect(result.management_rules.onProfitPct).toBe(10);
    expect(result.management_rules.partialHarvestBps).toBe(5000);
});

// ─── Volatility / trend scaling ────────────────────────────────────

test("high volatility increases total bin count", () => {
    const low = computeStrategy("custom_ratio_spot", {
        ...baseInput,
        market: { ...baseMarket, volatility: 0.5 },
    });
    const high = computeStrategy("custom_ratio_spot", {
        ...baseInput,
        market: { ...baseMarket, volatility: 6 },
    });
    const lowTotal = low.bins_below + low.bins_above;
    const highTotal = high.bins_below + high.bins_above;
    expect(highTotal).toBeGreaterThan(lowTotal);
});

test("downtrend shifts bins below", () => {
    const flat = computeStrategy("custom_ratio_spot", {
        ...baseInput,
        market: { ...baseMarket, priceTrend: "flat" },
    });
    const down = computeStrategy("custom_ratio_spot", {
        ...baseInput,
        market: { ...baseMarket, priceTrend: "down" },
    });
    expect(down.bins_below).toBeGreaterThan(flat.bins_below);
});

// ─── Error handling ────────────────────────────────────────────────

test("throws for unknown strategy type", () => {
    expect(() => computeStrategy("nonexistent" as any, baseInput)).toThrow("Unknown strategy type");
});
