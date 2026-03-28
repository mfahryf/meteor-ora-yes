// src/strategy/screener.ts
import type { PoolCandidate } from "./types";
import type { Config } from "../config/schema";
import { discoverPools } from "../chain/scanner";
import { getOpenPositions } from "../memory/positions";
import { logger } from "../utils/logger";
import type { StrategyType } from "./types";

import type { DeployParams } from "./types";

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

    return allPools
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
        })
        .map(pool => {
            pool.score = computePoolScore(pool, s);
            return pool;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 200);
}

function computePoolScore(pool: PoolCandidate, s: Config["screening"]): number {
    let score = 0;

    // Fee generation weight (40%)
    if (pool.feeActiveTvlRatio >= s.minFeeActiveTvlRatio) {
        score += Math.min(pool.feeActiveTvlRatio / s.minFeeActiveTvlRatio, 2) * 40;
    }

    // Volume health (30%)
    if (pool.volume24h >= s.minVolume) {
        score += Math.min(pool.volume24h / s.minVolume, 2) * 30;
    }

    // TVL preference (15%)
    if (pool.tvl >= s.minTvl && pool.tvl <= s.maxTvl) {
        score += 15;
    }

    // APR boost (10%)
    score += Math.min(pool.feeApr / 2, 1) * 10;

    // Volatility in range (5%)
    if (pool.volatility > 0 && pool.volatility < 5) {
        score += 5;
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

    // Token ratio based on momentum
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
