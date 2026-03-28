// src/tools/strategies.ts
// 5 built-in strategy compute functions — pure, no side effects.
// Each takes pool + market data and returns deploy params.

import type { PoolCandidate, StrategyType, DeployParams } from "../strategy/types";

interface MarketSignals {
    priceChange1hPct: number;
    priceChange24hPct: number;
    netBuyers1h: number;
    netBuyers24h: number;
    volatility: number;
    priceTrend: "up" | "down" | "flat";
}

interface ComputeInput {
    pool: PoolCandidate;
    market: MarketSignals;
    walletSolBalance: number;
    maxDeploySol: number;
    gasReserve: number;
}

interface ManagementRules {
    onOorDown: "close" | "reseed" | "hold";
    onOorUp: "close" | "hold";
    onProfitPct: number | null;
    compoundFees: boolean;
    partialHarvestBps: number | null;
}

interface ComputeOutput {
    strategy_type: StrategyType;
    bins_below: number;
    bins_above: number;
    amount_sol: number;
    amount_token: number;
    need_swap: boolean;
    swap_amount_sol: number;
    management_rules: ManagementRules;
}

// ─── Helpers ───────────────────────────────────────────────────────

function clampTotalBins(volatility: number): number {
    if (volatility < 1) return 30;
    if (volatility < 3) return 40;
    if (volatility < 5) return 55;
    return 65;
}

function directionalSplit(totalBins: number, trend: "up" | "down" | "flat"): { below: number; above: number } {
    switch (trend) {
        case "down": {
            const below = Math.round(totalBins * 0.75);
            return { below, above: totalBins - below };
        }
        case "up": {
            const below = Math.round(totalBins * 0.35);
            return { below, above: totalBins - below };
        }
        default: {
            const below = Math.round(totalBins * 0.55);
            return { below, above: totalBins - below };
        }
    }
}

function tokenRatioFromMomentum(market: MarketSignals): { token: number; sol: number } {
    const { priceChange1hPct, netBuyers1h, priceTrend } = market;
    if (priceChange1hPct > 5 && netBuyers1h > 10 && priceTrend === "up") return { token: 0.8, sol: 0.2 };
    if (priceChange1hPct > 1 && priceTrend === "up") return { token: 0.7, sol: 0.3 };
    if (priceTrend === "flat") return { token: 0.5, sol: 0.5 };
    if (priceChange1hPct < -1 && priceTrend === "down") return { token: 0.3, sol: 0.7 };
    return { token: 0.2, sol: 0.8 };
}

function deployAmount(walletSol: number, maxDeploy: number): number {
    const usable = walletSol * 0.8;
    return Math.min(usable, maxDeploy);
}

// ─── 1. Custom Ratio Spot ──────────────────────────────────────────
// Price momentum + net buyers → ratio. Volatility → bins. Trend → direction.

function customRatioSpot(input: ComputeInput): ComputeOutput {
    const totalBins = clampTotalBins(input.market.volatility);
    const { below, above } = directionalSplit(totalBins, input.market.priceTrend);
    const { token, sol } = tokenRatioFromMomentum(input.market);
    const amountSol = deployAmount(input.walletSolBalance, input.maxDeploySol);
    const swapAmount = token > 0 ? amountSol * token : 0;

    return {
        strategy_type: "custom_ratio_spot",
        bins_below: below,
        bins_above: above,
        amount_sol: amountSol * sol,
        amount_token: 0,
        need_swap: token > 0,
        swap_amount_sol: swapAmount,
        management_rules: {
            onOorDown: "close",
            onOorUp: "close",
            onProfitPct: null,
            compoundFees: false,
            partialHarvestBps: null,
        },
    };
}

// ─── 2. Single-Sided Reseed ────────────────────────────────────────
// 100% token, wide bins below. OOR down → reseed, not close.

function singleSidedReseed(input: ComputeInput): ComputeOutput {
    const vol = input.market.volatility;
    const binsBelow = vol < 1 ? 20 : vol < 3 ? 35 : vol < 5 ? 45 : 50;
    const amountSol = deployAmount(input.walletSolBalance, input.maxDeploySol);

    return {
        strategy_type: "single_sided_reseed",
        bins_below: binsBelow,
        bins_above: 0,
        amount_sol: 0,
        amount_token: 0,
        need_swap: true,
        swap_amount_sol: amountSol,
        management_rules: {
            onOorDown: "reseed",
            onOorUp: "hold",
            onProfitPct: null,
            compoundFees: false,
            partialHarvestBps: null,
        },
    };
}

// ─── 3. Fee Compounding ────────────────────────────────────────────
// Balanced 50/50, ±35 bins. Claim fees → re-add when >$5.

function feeCompounding(input: ComputeInput): ComputeOutput {
    const totalBins = Math.min(clampTotalBins(input.market.volatility), 69);
    const half = Math.round(totalBins / 2);
    const amountSol = deployAmount(input.walletSolBalance, input.maxDeploySol);

    return {
        strategy_type: "fee_compounding",
        bins_below: half,
        bins_above: half,
        amount_sol: amountSol * 0.5,
        amount_token: 0,
        need_swap: true,
        swap_amount_sol: amountSol * 0.5,
        management_rules: {
            onOorDown: "close",
            onOorUp: "close",
            onProfitPct: null,
            compoundFees: true,
            partialHarvestBps: null,
        },
    };
}

// ─── 4. Multi-Layer ────────────────────────────────────────────────
// Split capital into 2-3 layers with stacked shapes. Manage as one unit.

function multiLayer(input: ComputeInput): ComputeOutput {
    const totalBins = clampTotalBins(input.market.volatility);
    const { below, above } = directionalSplit(totalBins, input.market.priceTrend);
    const amountSol = deployAmount(input.walletSolBalance, input.maxDeploySol);
    // Layer 1: inner 60% of range. Layer 2: outer 40%.
    // Return params for primary layer; agent handles second deploy.

    return {
        strategy_type: "multi_layer",
        bins_below: Math.round(below * 0.6),
        bins_above: Math.round(above * 0.6),
        amount_sol: amountSol * 0.6,
        amount_token: 0,
        need_swap: true,
        swap_amount_sol: amountSol * 0.3,
        management_rules: {
            onOorDown: "close",
            onOorUp: "hold",
            onProfitPct: null,
            compoundFees: false,
            partialHarvestBps: null,
        },
    };
}

// ─── 5. Partial Harvest ────────────────────────────────────────────
// 50/50, slightly wider than compounding. 10% total return → withdraw 50%.

function partialHarvest(input: ComputeInput): ComputeOutput {
    const totalBins = clampTotalBins(input.market.volatility);
    // Slightly wider: +20% on each side
    const half = Math.round((totalBins / 2) * 1.2);
    const amountSol = deployAmount(input.walletSolBalance, input.maxDeploySol);

    return {
        strategy_type: "partial_harvest",
        bins_below: half,
        bins_above: half,
        amount_sol: amountSol * 0.5,
        amount_token: 0,
        need_swap: true,
        swap_amount_sol: amountSol * 0.5,
        management_rules: {
            onOorDown: "close",
            onOorUp: "hold",
            onProfitPct: 10,
            compoundFees: false,
            partialHarvestBps: 5000, // 50% in bps
        },
    };
}

// ─── Public dispatch ───────────────────────────────────────────────

const COMPUTE_FNS: Record<StrategyType, (input: ComputeInput) => ComputeOutput> = {
    custom_ratio_spot: customRatioSpot,
    single_sided_reseed: singleSidedReseed,
    fee_compounding: feeCompounding,
    multi_layer: multiLayer,
    partial_harvest: partialHarvest,
    bid_ask: customRatioSpot, // bid_ask uses same logic as custom_ratio_spot
};

export function computeStrategy(type: StrategyType, input: ComputeInput): ComputeOutput {
    const fn = COMPUTE_FNS[type];
    if (!fn) throw new Error(`Unknown strategy type: ${type}`);
    return fn(input);
}

export type { ComputeInput, ComputeOutput, ManagementRules, MarketSignals };
