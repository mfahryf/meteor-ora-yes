// src/simulation/simulator.ts
// Main shadow trading simulator — runs the full agent pipeline with real data
// but uses virtual SOL instead of real transactions

import { getTopCandidates } from "../strategy/screener";
import { runBullBearDebate } from "../brain/debate";
import { getPoolDetail } from "../chain/scanner";
import {
    getDefaultPortfolio,
    openShadowPosition,
    getOpenShadowPositions,
    getShadowHistory,
    createPortfolio,
    type ShadowPortfolio,
} from "./shadow-portfolio";
import { monitorShadowPositions } from "./monitor";
import { insertOutcome } from "../memory/outcomes";
import type { Config } from "../config/schema";
import type { PoolCandidate } from "../strategy/types";
import { logger } from "../utils/logger";

// ─── Simulation Cycle ──────────────────────────────────────────────

export interface SimulationResult {
    cycle: number;
    screened: number;
    topCandidates: any[];
    preScreenPassed: number;
    debated: number;
    deployed: number; // shadow deployments
    monitored: number;
    closed: number;
    portfolioBalance: number;
    portfolioPnlPct: number;
    errors: string[];
}

/**
 * Run one full simulation cycle:
 * 1. Screen pools (real Meteora data + DexScreener pre-screening)
 * 2. Debate top candidates (if enabled)
 * 3. Shadow-deploy winning candidates
 * 4. Monitor existing shadow positions
 * 5. Close positions that hit exit triggers
 */
export async function runSimulationCycle(
    config: Config,
    cycleNumber: number = 1,
): Promise<SimulationResult> {
    const result: SimulationResult = {
        cycle: cycleNumber,
        screened: 0,
        topCandidates: [],
        preScreenPassed: 0,
        debated: 0,
        deployed: 0,
        monitored: 0,
        closed: 0,
        portfolioBalance: 0,
        portfolioPnlPct: 0,
        errors: [],
    };

    const portfolio = getDefaultPortfolio();

    logger.info({
        cycle: cycleNumber,
        balance: portfolio.current_balance_sol.toFixed(4),
        openPositions: getOpenShadowPositions(portfolio.id).length,
    }, "🔮 Starting simulation cycle");

    // ── Step 1: Screen pools (uses REAL market data) ──────────────
    let candidates: PoolCandidate[];
    try {
        candidates = await getTopCandidates(config);
        result.screened = candidates.length;
        result.preScreenPassed = candidates.length; // already pre-screened
        result.topCandidates = candidates.slice(0, 5);
    } catch (error) {
        result.errors.push(`Screening failed: ${error}`);
        logger.error({ error: String(error) }, "Simulation screening failed");
        candidates = [];
    }

    // ── Step 2: Check capacity ────────────────────────────────────
    const openPositions = getOpenShadowPositions(portfolio.id);
    const maxPositions = config.risk.maxPositions;
    const slotsAvailable = maxPositions - openPositions.length;

    if (slotsAvailable <= 0) {
        logger.info({ open: openPositions.length, max: maxPositions }, "🔮 No slots available, skipping deployment");
    }

    // ── Step 3: Evaluate and shadow-deploy ────────────────────────
    const deployAmount = Math.min(
        config.management.deployAmountSol,
        config.risk.maxDeployAmount,
        portfolio.current_balance_sol * 0.4, // max 40% per position
    );

    if (slotsAvailable > 0 && candidates.length > 0 && deployAmount >= config.management.minSolToOpen) {
        // Take top candidates (max = available slots, but limit to 1 per cycle for realism)
        const topCandidates = candidates.slice(0, Math.min(1, slotsAvailable));

        for (const candidate of topCandidates) {
            try {
                // Already deployed to this pool?
                const alreadyIn = openPositions.some(p => p.pool_address === candidate.address);
                if (alreadyIn) continue;

                // Run debate if enabled
                let debateResult: any = null;
                if (config.screening.useDebate) {
                    debateResult = await runBullBearDebate(candidate, config);
                    result.debated++;

                    if (debateResult.recommendation === "skip") {
                        logger.info({
                            pool: candidate.address,
                            arbiterScore: debateResult.arbiterScore,
                        }, "🔮 Debate: SKIP");
                        continue;
                    }
                }

                // Get current pool detail for entry price
                let entryPrice = 0;
                try {
                    const poolDetail = await getPoolDetail(candidate.address);
                    entryPrice = poolDetail.currentPrice;
                } catch {
                    entryPrice = 0; // will use DexScreener price if available
                }

                if (entryPrice === 0 && candidate.dexScreener) {
                    // Fallback: use DexScreener price is not directly available
                    // but we can use the liquidity as a proxy
                    entryPrice = 1; // placeholder, relative changes still tracked
                }

                // Shadow deploy!
                const tokenMint = candidate.tokenAMint !== "So11111111111111111111111111111111111111112"
                    ? candidate.tokenAMint
                    : candidate.tokenBMint;

                openShadowPosition({
                    portfolio_id: portfolio.id,
                    pool_address: candidate.address,
                    token_a_symbol: candidate.tokenASymbol,
                    token_b_symbol: candidate.tokenBSymbol,
                    token_a_mint: tokenMint,
                    strategy_type: config.management.strategy,
                    bin_step: candidate.binStep,
                    bins_below: config.management.binsBelow,
                    bins_above: config.management.binsAbove,
                    entry_price: entryPrice,
                    entry_amount_sol: deployAmount,
                    entry_tvl: candidate.tvl,
                    entry_volume_24h: candidate.volume24h,
                    entry_fee_apr: candidate.feeApr,
                    entry_timestamp: new Date().toISOString(),
                    dex_buy_sell_ratio: candidate.dexScreener?.buySellRatio24h,
                    dex_price_change_1h: candidate.dexScreener?.priceChange1h,
                    dex_pair_age_hours: candidate.dexScreener?.pairAgeHours,
                    dex_liquidity_usd: candidate.dexScreener?.liquidityUsd,
                    debate_bull_score: debateResult?.bullScore,
                    debate_bear_score: debateResult?.bearScore,
                    debate_arbiter_score: debateResult?.arbiterScore,
                });

                result.deployed++;
            } catch (error) {
                result.errors.push(`Deploy failed for ${candidate.address}: ${error}`);
            }
        }
    }

    // ── Step 4: Monitor existing positions ────────────────────────
    try {
        const monitorResult = await monitorShadowPositions(config);
        result.monitored = monitorResult.checked;
        result.closed = monitorResult.closed;
    } catch (error) {
        result.errors.push(`Monitor failed: ${error}`);
    }

    // ── Step 5: Update portfolio summary ──────────────────────────
    const updatedPortfolio = getDefaultPortfolio();
    result.portfolioBalance = updatedPortfolio.current_balance_sol;
    result.portfolioPnlPct = ((updatedPortfolio.current_balance_sol - updatedPortfolio.initial_balance_sol) / updatedPortfolio.initial_balance_sol) * 100;

    logger.info({
        cycle: cycleNumber,
        screened: result.screened,
        deployed: result.deployed,
        monitored: result.monitored,
        closed: result.closed,
        balance: result.portfolioBalance.toFixed(4),
        pnl: result.portfolioPnlPct.toFixed(1) + "%",
        errors: result.errors.length,
    }, "🔮 Simulation cycle complete");

    return result;
}

// ─── Simulation Report ─────────────────────────────────────────────

export interface SimulationReport {
    portfolio: ShadowPortfolio;
    openPositions: any[];
    closedPositions: any[];
    winRate: number;
    avgPnlPct: number;
    bestTrade: any;
    worstTrade: any;
    totalCycles: number;
}

export function getSimulationReport(portfolioId?: number): SimulationReport {
    const portfolio = portfolioId
        ? (() => { const { getPortfolio } = require("./shadow-portfolio"); return getPortfolio(portfolioId); })()
        : getDefaultPortfolio();

    const openPositions = getOpenShadowPositions(portfolio.id);
    const closedPositions = getShadowHistory(portfolio.id, 100);

    const winRate = portfolio.positions_closed > 0
        ? (portfolio.win_count / portfolio.positions_closed) * 100
        : 0;

    const avgPnlPct = closedPositions.length > 0
        ? closedPositions.reduce((sum, p) => sum + (p.final_pnl_pct || 0), 0) / closedPositions.length
        : 0;

    const bestTrade = closedPositions.length > 0
        ? closedPositions.reduce((best, p) => (p.final_pnl_pct || 0) > (best.final_pnl_pct || 0) ? p : best)
        : null;

    const worstTrade = closedPositions.length > 0
        ? closedPositions.reduce((worst, p) => (p.final_pnl_pct || 0) < (worst.final_pnl_pct || 0) ? p : worst)
        : null;

    return {
        portfolio,
        openPositions,
        closedPositions,
        winRate,
        avgPnlPct,
        bestTrade,
        worstTrade,
        totalCycles: portfolio.positions_opened, // rough proxy
    };
}
