// src/strategy/pre-screen.ts
// DexScreener-based pre-screening layer — runs BEFORE Meteora pool scoring
// Filters out dangerous tokens early to save LLM calls and on-chain lookups

import { getTokenPairs, getTokensBatch, getBoostedTokens, extractMarketData } from "../chain/dexscreener";
import type { DexScreenerMarketData } from "../chain/dexscreener";
import type { Config } from "../config/schema";
import { logger } from "../utils/logger";

// ─── Types ─────────────────────────────────────────────────────────

export interface PreScreenResult {
    pass: boolean;
    tokenMint: string;
    reason?: string;
    marketData: DexScreenerMarketData | null;
    score: number;       // bonus/penalty score from pre-screening
    checks: {
        liquidity: boolean;
        priceChange: boolean;
        txnCount: boolean;
        buySellRatio: boolean;
        pairAge: boolean;
    };
}

export interface PreScreenConfig {
    enabled: boolean;
    minLiquidityUsd: number;
    maxPriceChange24hPct: number;
    minPriceChange24hPct: number;
    minTxns24h: number;
    minBuySellRatio: number;
    maxBuySellRatio: number;
    minPairAgeHours: number;
    boostBonusScore: number;
}

// ─── Boosted Token Cache ───────────────────────────────────────────

let boostedCache: Set<string> = new Set();
let lastBoostedFetch = 0;
const BOOST_CACHE_TTL = 5 * 60 * 1000; // refresh every 5 min

async function getBoostedSet(): Promise<Set<string>> {
    const now = Date.now();
    if (now - lastBoostedFetch > BOOST_CACHE_TTL) {
        try {
            const boosts = await getBoostedTokens();
            boostedCache = new Set(
                boosts
                    .filter(b => b.chainId === "solana")
                    .map(b => b.tokenAddress)
            );
            lastBoostedFetch = now;
            logger.debug({ count: boostedCache.size }, "Boosted tokens cache refreshed");
        } catch (error) {
            logger.warn({ error: String(error) }, "Failed to refresh boosted tokens cache");
        }
    }
    return boostedCache;
}

// ─── Pre-screen Single Token ───────────────────────────────────────

/**
 * Pre-screen a single token using DexScreener data.
 * Returns pass/fail + enriched market data for scoring.
 */
export async function preScreenToken(
    tokenMint: string,
    config: PreScreenConfig,
): Promise<PreScreenResult> {
    if (!config.enabled) {
        return {
            pass: true,
            tokenMint,
            reason: "pre-screening disabled",
            marketData: null,
            score: 0,
            checks: { liquidity: true, priceChange: true, txnCount: true, buySellRatio: true, pairAge: true },
        };
    }

    const pairs = await getTokenPairs(tokenMint);

    if (pairs.length === 0) {
        return {
            pass: false,
            tokenMint,
            reason: "no pairs found on DexScreener",
            marketData: null,
            score: -100,
            checks: { liquidity: false, priceChange: false, txnCount: false, buySellRatio: false, pairAge: false },
        };
    }

    // Pick the most liquid pair on Solana
    const solanaPairs = pairs.filter(p => p.chainId === "solana");
    if (solanaPairs.length === 0) {
        return {
            pass: false,
            tokenMint,
            reason: "no Solana pairs on DexScreener",
            marketData: null,
            score: -100,
            checks: { liquidity: false, priceChange: false, txnCount: false, buySellRatio: false, pairAge: false },
        };
    }

    const bestPair = solanaPairs.reduce((best, curr) =>
        (curr.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? curr : best
    );

    const boosted = await getBoostedSet();
    const marketData = extractMarketData(bestPair, boosted);

    // Run checks
    const checks = {
        liquidity: marketData.liquidityUsd >= config.minLiquidityUsd,
        priceChange: marketData.priceChange24h >= config.minPriceChange24hPct
            && marketData.priceChange24h <= config.maxPriceChange24hPct,
        txnCount: (marketData.buys24h + marketData.sells24h) >= config.minTxns24h,
        buySellRatio: marketData.buySellRatio24h >= config.minBuySellRatio
            && marketData.buySellRatio24h <= config.maxBuySellRatio,
        pairAge: marketData.pairAgeHours >= config.minPairAgeHours,
    };

    // Build rejection reason
    const rejections: string[] = [];
    if (!checks.liquidity) rejections.push(`liquidity $${marketData.liquidityUsd.toFixed(0)} < min $${config.minLiquidityUsd}`);
    if (!checks.priceChange) rejections.push(`priceChange24h ${marketData.priceChange24h.toFixed(1)}% outside [${config.minPriceChange24hPct}%, ${config.maxPriceChange24hPct}%]`);
    if (!checks.txnCount) rejections.push(`txns24h ${marketData.buys24h + marketData.sells24h} < min ${config.minTxns24h}`);
    if (!checks.buySellRatio) rejections.push(`buySellRatio ${marketData.buySellRatio24h.toFixed(2)} outside [${config.minBuySellRatio}, ${config.maxBuySellRatio}]`);
    if (!checks.pairAge) rejections.push(`pairAge ${marketData.pairAgeHours.toFixed(1)}h < min ${config.minPairAgeHours}h`);

    const pass = Object.values(checks).every(Boolean);

    // Compute bonus score
    let score = 0;
    if (pass) {
        // Liquidity bonus: higher is better (log scale)
        if (marketData.liquidityUsd > 50000) score += 10;
        else if (marketData.liquidityUsd > 20000) score += 5;

        // Volume strength
        if (marketData.volume24h > 100000) score += 10;
        else if (marketData.volume24h > 50000) score += 5;

        // Healthy buy pressure
        if (marketData.buySellRatio24h > 1.2 && marketData.buySellRatio24h < 2.5) score += 5;

        // Boost signal
        if (marketData.isBoosted) score += config.boostBonusScore;

        // Mature pair bonus
        if (marketData.pairAgeHours > 72) score += 5; // > 3 days
    }

    if (!pass) {
        logger.info(
            { tokenMint, rejections, priceChange24h: marketData.priceChange24h, liquidity: marketData.liquidityUsd },
            "Token FAILED pre-screen"
        );
    }

    return {
        pass,
        tokenMint,
        reason: pass ? undefined : rejections.join("; "),
        marketData,
        score,
        checks,
    };
}

// ─── Batch Pre-screen ──────────────────────────────────────────────

/**
 * Pre-screen multiple tokens in batch (max 30 per DexScreener call).
 * More efficient than individual calls.
 */
export async function preScreenBatch(
    tokenMints: string[],
    config: PreScreenConfig,
): Promise<Map<string, PreScreenResult>> {
    const results = new Map<string, PreScreenResult>();

    if (!config.enabled) {
        for (const mint of tokenMints) {
            results.set(mint, {
                pass: true,
                tokenMint: mint,
                reason: "pre-screening disabled",
                marketData: null,
                score: 0,
                checks: { liquidity: true, priceChange: true, txnCount: true, buySellRatio: true, pairAge: true },
            });
        }
        return results;
    }

    // Deduplicate
    const uniqueMints = [...new Set(tokenMints)];
    const boosted = await getBoostedSet();

    // Batch in chunks of 30
    for (let i = 0; i < uniqueMints.length; i += 30) {
        const chunk = uniqueMints.slice(i, i + 30);
        const pairs = await getTokensBatch(chunk);

        // Group pairs by base token address
        const pairsByToken = new Map<string, typeof pairs>();
        for (const pair of pairs) {
            const addr = pair.baseToken?.address;
            if (!addr) continue;
            if (!pairsByToken.has(addr)) pairsByToken.set(addr, []);
            pairsByToken.get(addr)!.push(pair);
        }

        // Process each token
        for (const mint of chunk) {
            const tokenPairs = pairsByToken.get(mint) ?? [];

            if (tokenPairs.length === 0) {
                results.set(mint, {
                    pass: false,
                    tokenMint: mint,
                    reason: "no pairs found on DexScreener",
                    marketData: null,
                    score: -100,
                    checks: { liquidity: false, priceChange: false, txnCount: false, buySellRatio: false, pairAge: false },
                });
                continue;
            }

            // Pick most liquid Solana pair
            const solanaPairs = tokenPairs.filter(p => p.chainId === "solana");
            if (solanaPairs.length === 0) {
                results.set(mint, {
                    pass: false,
                    tokenMint: mint,
                    reason: "no Solana pairs on DexScreener",
                    marketData: null,
                    score: -100,
                    checks: { liquidity: false, priceChange: false, txnCount: false, buySellRatio: false, pairAge: false },
                });
                continue;
            }

            const bestPair = solanaPairs.reduce((best, curr) =>
                (curr.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? curr : best
            );

            const marketData = extractMarketData(bestPair, boosted);

            const checks = {
                liquidity: marketData.liquidityUsd >= config.minLiquidityUsd,
                priceChange: marketData.priceChange24h >= config.minPriceChange24hPct
                    && marketData.priceChange24h <= config.maxPriceChange24hPct,
                txnCount: (marketData.buys24h + marketData.sells24h) >= config.minTxns24h,
                buySellRatio: marketData.buySellRatio24h >= config.minBuySellRatio
                    && marketData.buySellRatio24h <= config.maxBuySellRatio,
                pairAge: marketData.pairAgeHours >= config.minPairAgeHours,
            };

            const pass = Object.values(checks).every(Boolean);

            let score = 0;
            if (pass) {
                if (marketData.liquidityUsd > 50000) score += 10;
                else if (marketData.liquidityUsd > 20000) score += 5;
                if (marketData.volume24h > 100000) score += 10;
                else if (marketData.volume24h > 50000) score += 5;
                if (marketData.buySellRatio24h > 1.2 && marketData.buySellRatio24h < 2.5) score += 5;
                if (marketData.isBoosted) score += config.boostBonusScore;
                if (marketData.pairAgeHours > 72) score += 5;
            }

            const rejections: string[] = [];
            if (!checks.liquidity) rejections.push(`liquidity $${marketData.liquidityUsd.toFixed(0)} < $${config.minLiquidityUsd}`);
            if (!checks.priceChange) rejections.push(`priceChange24h ${marketData.priceChange24h.toFixed(1)}% outside range`);
            if (!checks.txnCount) rejections.push(`txns ${marketData.buys24h + marketData.sells24h} < ${config.minTxns24h}`);
            if (!checks.buySellRatio) rejections.push(`buySellRatio ${marketData.buySellRatio24h.toFixed(2)} outside range`);
            if (!checks.pairAge) rejections.push(`pairAge ${marketData.pairAgeHours.toFixed(1)}h < ${config.minPairAgeHours}h`);

            results.set(mint, {
                pass,
                tokenMint: mint,
                reason: pass ? undefined : rejections.join("; "),
                marketData,
                score,
                checks,
            });
        }
    }

    const passCount = [...results.values()].filter(r => r.pass).length;
    logger.info(
        { total: results.size, passed: passCount, failed: results.size - passCount },
        "Batch pre-screen completed"
    );

    return results;
}
