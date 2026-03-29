// src/strategy/screener.ts
import type { PoolCandidate } from "./types";
import type { Config } from "../config/schema";
import { discoverPools } from "../chain/scanner";
import { getOpenPositions } from "../memory/positions";
import { preScreenBatch } from "./pre-screen";
import { logger } from "../utils/logger";
import type { StrategyType } from "./types";

import type { DeployParams } from "./types";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function getTopCandidates(config: Config): Promise<PoolCandidate[]> {
    const s = config.screening;

    const allPools = await discoverPools({
        minTvl: s.minTvl,
        maxTvl: s.maxTvl,
        minVolume: s.minVolume,
        minBinStep: s.minBinStep,
        maxBinStep: s.maxBinStep,
        limit: 200,
    });

    logger.info({ poolCount: allPools.length }, "Discovered pools for screening");

    // Build initial candidates
    let candidates: PoolCandidate[] = allPools
        .map(pool => ({
            ...pool,
            address: pool.address,
            tokenAMint: pool.tokenAMint || "",
            tokenBMint: pool.tokenBMint || "",
            tokenASymbol: pool.tokenASymbol || "",
            tokenBSymbol: pool.tokenBSymbol || "",
            binStep: pool.binStep,
            tvl: pool.tvl,
            volume24h: pool.volume24h,
            fees24h: pool.fees24h,
            feeApr: pool.feeApr || 0,
            feeActiveTvlRatio: pool.feeActiveTvlRatio || 0,
            volatility: pool.volatility || 0,
            priceTrend: pool.priceTrend || "flat",
            netBuyers: 0,
            poolAgeDays: 0,
            score: 0,
        }))
        .filter(pool => {
            if (pool.binStep < s.minBinStep || pool.binStep > s.maxBinStep) return false;
            if (pool.tvl < s.minTvl) return false;
            if (pool.volume24h < s.minVolume) return false;
            return true;
        });

    // ─── DexScreener Pre-screening ─────────────────────────────────
    if (config.dexScreener.enabled) {
        // Collect unique non-SOL token mints for batch pre-screening
        const tokenMints = new Set<string>();
        for (const pool of candidates) {
            if (pool.tokenAMint && pool.tokenAMint !== SOL_MINT) tokenMints.add(pool.tokenAMint);
            if (pool.tokenBMint && pool.tokenBMint !== SOL_MINT) tokenMints.add(pool.tokenBMint);
        }

        logger.info({ uniqueTokens: tokenMints.size }, "Running DexScreener pre-screen batch");

        const preScreenResults = await preScreenBatch(
            [...tokenMints],
            config.dexScreener.preScreen,
        );

        // Filter and enrich candidates with DexScreener data
        candidates = candidates.filter(pool => {
            // Find the non-SOL token to check
            const tokenMint = pool.tokenAMint !== SOL_MINT ? pool.tokenAMint : pool.tokenBMint;
            if (!tokenMint || tokenMint === SOL_MINT) return true; // SOL/SOL pair, skip check

            const result = preScreenResults.get(tokenMint);
            if (!result) return true; // no data, don't filter

            // Enrich candidate with DexScreener data
            if (result.marketData) {
                const md = result.marketData;

                // ── BUG FIX: populate poolAgeDays from DexScreener pairCreatedAt ──
                pool.poolAgeDays = md.pairAgeHours / 24;

                // ── BUG FIX: populate netBuyers from DexScreener txns ──
                pool.netBuyers = md.buys24h - md.sells24h;

                // Attach DexScreener enriched data
                pool.dexScreener = {
                    priceChange5m: md.priceChange5m,
                    priceChange1h: md.priceChange1h,
                    priceChange6h: md.priceChange6h,
                    priceChange24h: md.priceChange24h,
                    buys24h: md.buys24h,
                    sells24h: md.sells24h,
                    buySellRatio24h: md.buySellRatio24h,
                    liquidityUsd: md.liquidityUsd,
                    fdv: md.fdv,
                    marketCap: md.marketCap,
                    pairAgeHours: md.pairAgeHours,
                    isBoosted: md.isBoosted,
                    boostAmount: md.boostAmount,
                    preScreenScore: result.score,
                };
            }

            return result.pass;
        });

        const filtered = allPools.length - candidates.length;
        logger.info({ before: allPools.length, after: candidates.length, filtered }, "DexScreener pre-screen completed");
    }

    // Score and sort
    return candidates
        .map(pool => {
            pool.score = computePoolScore(pool, s);
            return pool;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 200);
}

function computePoolScore(pool: PoolCandidate, s: Config["screening"]): number {
    let score = 0;

    // Fee generation weight (35%)
    if (pool.feeActiveTvlRatio >= s.minFeeActiveTvlRatio) {
        score += Math.min(pool.feeActiveTvlRatio / s.minFeeActiveTvlRatio, 2) * 35;
    }

    // Volume health (25%)
    if (pool.volume24h >= s.minVolume) {
        score += Math.min(pool.volume24h / s.minVolume, 2) * 25;
    }

    // TVL preference (10%)
    if (pool.tvl >= s.minTvl && pool.tvl <= s.maxTvl) {
        score += 10;
    }

    // APR boost (10%)
    score += Math.min(pool.feeApr / 2, 1) * 10;

    // Volatility in range (5%)
    if (pool.volatility > 0 && pool.volatility < 5) {
        score += 5;
    }

    // ─── DexScreener-enhanced scoring (15%) ────────────────────────
    if (pool.dexScreener) {
        const ds = pool.dexScreener;

        // Pre-screen bonus (up to 5 points, scaled from pre-screen score)
        score += Math.min(ds.preScreenScore / 2, 5);

        // Healthy buy pressure (up to 3 points)
        if (ds.buySellRatio24h > 1.0 && ds.buySellRatio24h < 2.5) {
            score += 3;
        }

        // Positive recent momentum (up to 3 points)
        if (ds.priceChange1h > 0 && ds.priceChange1h < 20) {
            score += Math.min(ds.priceChange1h / 5, 3);
        }

        // Mature pair bonus (up to 2 points)
        if (pool.poolAgeDays > 3) {
            score += Math.min(pool.poolAgeDays / 5, 2);
        }

        // Boost bonus (2 points)
        if (ds.isBoosted) {
            score += 2;
        }
    }

    return Math.max(0, score);
}

export function computeDeployParams(
    pool: PoolCandidate,
    strategyType: StrategyType,
    walletSolBalance: number,
    config: Config,
): DeployParams {
    // Bin range based on volatility
    let totalBins: number;
    if (pool.volatility < 1) totalBins = 30;
    else if (pool.volatility < 3) totalBins = 40;
    else if (pool.volatility < 5) totalBins = 55;
    else totalBins = 65;

    totalBins = Math.max(20, Math.min(69, totalBins));

    // Directional split based on price trend
    let binsBelow: number;
    let binsAbove: number;
    switch (pool.priceTrend) {
        case "down":
            binsBelow = Math.round(totalBins * 0.75);
            binsAbove = totalBins - binsBelow;
            break;
        case "up":
            binsBelow = Math.round(totalBins * 0.35);
            binsAbove = totalBins - binsBelow;
            break;
        case "flat":
        default:
            binsBelow = Math.round(totalBins * 0.55);
            binsAbove = totalBins - binsBelow;
            break;
    }

    // Token ratio based on momentum — now uses REAL netBuyers from DexScreener
    let tokenRatio: number;
    let solRatio: number;
    if (pool.netBuyers > 10 && pool.priceTrend === "up") {
        tokenRatio = 0.8; solRatio = 0.2;
    } else if (pool.priceTrend === "up") {
        tokenRatio = 0.7; solRatio = 0.3;
    } else if (pool.priceTrend === "flat") {
        tokenRatio = 0.5; solRatio = 0.5;
    } else if (pool.priceTrend === "down") {
        tokenRatio = 0.3; solRatio = 0.7;
    } else {
        tokenRatio = 0.2; solRatio = 0.8;
    }

    // Deploy amount (respect max and wallet)
    const maxDeploy = Math.min(walletSolBalance, config.risk.maxDeployAmount);
    const deployAmount = walletSolBalance > maxDeploy ? maxDeploy : walletSolBalance * 0.8;
    // Keep 20% reserve

    return {
        poolAddress: pool.address,
        binStep: pool.binStep,
        minBin: -binsBelow,
        maxBin: binsAbove - binsBelow + 1,
        totalBins,
        binsBelow,
        binsAbove,
        amountSol: deployAmount,
        strategyType,
        tokenRatio,
        solRatio,
    };
}
