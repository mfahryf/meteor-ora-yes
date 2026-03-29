// src/simulation/monitor.ts
// Shadow position monitor — checks real market data and updates shadow positions
// Simulates what WOULD have happened: fee accumulation, IL, and exit triggers

import { getPoolDetail } from "../chain/scanner";
import { getTokenPairs, extractMarketData } from "../chain/dexscreener";
import {
    getOpenShadowPositions,
    updateShadowPosition,
    closeShadowPosition,
    type ShadowPosition,
} from "./shadow-portfolio";
import type { Config } from "../config/schema";
import { logger } from "../utils/logger";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// ─── Fee Estimation ────────────────────────────────────────────────

/**
 * Estimate fees earned by a shadow position based on pool's real fee data.
 * Uses proportional share: (position_sol / pool_tvl) * pool_fees_24h * (duration / 24h)
 */
function estimateFees(
    positionSol: number,
    poolTvl: number,
    poolFees24h: number,
    durationMinutes: number,
): number {
    if (poolTvl <= 0) return 0;
    const shareOfPool = positionSol / poolTvl;
    const hoursOpen = durationMinutes / 60;
    const feesPerHour = poolFees24h / 24;
    return shareOfPool * feesPerHour * hoursOpen;
}

// ─── Impermanent Loss Estimation ───────────────────────────────────

/**
 * Estimate impermanent loss based on price change.
 * IL formula: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 * For concentrated liquidity (DLMM), IL is amplified by ~bin_range factor.
 */
function estimateImpermanentLoss(priceChangePct: number, totalBins: number): number {
    const priceRatio = 1 + priceChangePct / 100;
    if (priceRatio <= 0) return -1; // total loss

    const ilFactor = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;

    // Concentrated liquidity amplifies IL by roughly (fullRange / concentratedRange)
    // For bins: the tighter the range, the higher the amplification
    const amplification = Math.max(1, 69 / Math.max(totalBins, 10));

    return ilFactor * amplification;
}

// ─── Exit Trigger Detection ────────────────────────────────────────

interface ExitSignal {
    shouldExit: boolean;
    reason: string;
}

function checkExitTriggers(
    pos: ShadowPosition,
    currentPrice: number,
    priceChangePct: number,
    pnlPct: number,
    durationMinutes: number,
    config: Config,
): ExitSignal {
    const mgmt = config.management;

    // 1. Emergency price drop
    if (priceChangePct <= mgmt.emergencyPriceDropPct) {
        return { shouldExit: true, reason: "emergency_price_drop" };
    }

    // 2. Take profit on fees
    const feePct = pos.accumulated_fees_sol > 0
        ? (pos.accumulated_fees_sol / pos.entry_amount_sol) * 100
        : 0;
    if (feePct >= mgmt.takeProfitFeePct) {
        return { shouldExit: true, reason: "take_profit_fee" };
    }

    // 3. Out of range timeout (simulated — check if price moved beyond bins)
    const totalBins = pos.bins_below + pos.bins_above;
    const binPriceRange = pos.bin_step * totalBins / 10000; // approximate
    if (Math.abs(priceChangePct / 100) > binPriceRange && durationMinutes > mgmt.outOfRangeWaitMinutes) {
        return { shouldExit: true, reason: "oor_timeout" };
    }

    // 4. Max duration (12h for shadow positions — we don't want indefinite holds)
    if (durationMinutes > 720) {
        return { shouldExit: true, reason: "max_duration" };
    }

    // 5. Severe PnL loss (> -25%)
    if (pnlPct < -25) {
        return { shouldExit: true, reason: "stop_loss" };
    }

    return { shouldExit: false, reason: "" };
}

// ─── Main Monitor Function ─────────────────────────────────────────

/**
 * Check all open shadow positions against real market data.
 * Updates prices, fees, PnL, and triggers exits when conditions are met.
 */
export async function monitorShadowPositions(config: Config): Promise<{
    checked: number;
    closed: number;
    errors: number;
}> {
    const openPositions = getOpenShadowPositions();
    let closed = 0;
    let errors = 0;

    if (openPositions.length === 0) {
        return { checked: 0, closed: 0, errors: 0 };
    }

    logger.info({ count: openPositions.length }, "🔮 Monitoring shadow positions");

    for (const pos of openPositions) {
        try {
            // Fetch real pool data
            let currentPrice: number;
            let poolTvl: number;
            let poolFees24h: number;
            let priceChangePct: number;

            // Try pool detail from Meteora
            try {
                const poolData = await getPoolDetail(pos.pool_address);
                currentPrice = poolData.currentPrice;
                poolTvl = poolData.tvl;
                poolFees24h = poolData.fees24h;
            } catch {
                // Fallback to DexScreener
                const pairs = await getTokenPairs(pos.token_a_mint);
                if (pairs.length === 0) {
                    logger.warn({ pool: pos.pool_address }, "Shadow position: cannot fetch market data");
                    errors++;
                    continue;
                }
                const md = extractMarketData(pairs[0]);
                currentPrice = md.priceUsd;
                poolTvl = md.liquidityUsd;
                poolFees24h = 0; // DexScreener doesn't have fee data
            }

            // Calculate metrics
            priceChangePct = pos.entry_price > 0
                ? ((currentPrice - pos.entry_price) / pos.entry_price) * 100
                : 0;

            const entryTime = new Date(pos.entry_timestamp).getTime();
            const durationMinutes = (Date.now() - entryTime) / (1000 * 60);

            const totalBins = pos.bins_below + pos.bins_above;
            const ilPct = estimateImpermanentLoss(priceChangePct, totalBins);
            const fees = estimateFees(pos.entry_amount_sol, poolTvl, poolFees24h, durationMinutes);

            // PnL = fees - IL impact
            const ilImpactSol = pos.entry_amount_sol * Math.abs(ilPct);
            const pnlSol = fees - ilImpactSol;
            const pnlPct = (pnlSol / pos.entry_amount_sol) * 100;

            // Update position
            updateShadowPosition(pos.id!, {
                current_price: currentPrice,
                price_change_pct: priceChangePct,
                accumulated_fees_sol: fees,
                unrealized_pnl_sol: pnlSol,
                unrealized_pnl_pct: pnlPct,
                duration_minutes: durationMinutes,
            });

            // Check exit triggers
            const exitSignal = checkExitTriggers(pos, currentPrice, priceChangePct, pnlPct, durationMinutes, config);

            if (exitSignal.shouldExit) {
                closeShadowPosition(pos.id!, {
                    exit_price: currentPrice,
                    exit_reason: exitSignal.reason,
                    final_pnl_sol: pnlSol,
                    final_pnl_pct: pnlPct,
                    accumulated_fees_sol: fees,
                });
                closed++;
            }

        } catch (error) {
            logger.warn({ pool: pos.pool_address, error: String(error) }, "Shadow monitor error");
            errors++;
        }
    }

    logger.info({ checked: openPositions.length, closed, errors }, "🔮 Shadow monitor cycle complete");
    return { checked: openPositions.length, closed, errors };
}
