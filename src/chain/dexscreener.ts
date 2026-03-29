// src/chain/dexscreener.ts
// DexScreener API client — all endpoints are FREE (no API key required)
// Docs: https://docs.dexscreener.com/api/reference

import { logger } from "../utils/logger";

const DEXSCREENER_API = "https://api.dexscreener.com";

// ─── Types ─────────────────────────────────────────────────────────

export interface DexScreenerToken {
    address: string;
    name: string;
    symbol: string;
}

export interface DexScreenerPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    labels?: string[];
    baseToken: DexScreenerToken;
    quoteToken: DexScreenerToken;
    priceNative: string;
    priceUsd: string;
    txns: {
        m5?: { buys: number; sells: number };
        h1?: { buys: number; sells: number };
        h6?: { buys: number; sells: number };
        h24?: { buys: number; sells: number };
    };
    volume: {
        m5?: number;
        h1?: number;
        h6?: number;
        h24?: number;
    };
    priceChange: {
        m5?: number;
        h1?: number;
        h6?: number;
        h24?: number;
    };
    liquidity: {
        usd: number;
        base: number;
        quote: number;
    };
    fdv: number;
    marketCap: number;
    pairCreatedAt: number; // unix timestamp ms
    info?: {
        imageUrl?: string;
        websites?: Array<{ url: string }>;
        socials?: Array<{ platform: string; handle: string }>;
    };
    boosts?: {
        active: number;
    };
}

export interface DexScreenerBoost {
    url: string;
    chainId: string;
    tokenAddress: string;
    amount: number;
    totalAmount: number;
    icon?: string;
    description?: string;
}

// ─── Rate Limiter (Token Bucket) ───────────────────────────────────

class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly maxTokens: number;
    private readonly refillRate: number; // tokens per ms

    constructor(requestsPerMinute: number) {
        this.maxTokens = requestsPerMinute;
        this.tokens = requestsPerMinute;
        this.refillRate = requestsPerMinute / 60000;
        this.lastRefill = Date.now();
    }

    async acquire(): Promise<void> {
        this.refill();
        if (this.tokens < 1) {
            const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
            logger.debug({ waitMs }, "DexScreener rate limit — waiting");
            await new Promise(resolve => setTimeout(resolve, waitMs));
            this.refill();
        }
        this.tokens -= 1;
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }
}

// 300 req/min for pair/token endpoints, 60 req/min for boost/profile endpoints
const pairLimiter = new RateLimiter(280);  // slight margin
const boostLimiter = new RateLimiter(55);

// ─── API Functions ─────────────────────────────────────────────────

/**
 * Get all pools for a given token address on Solana.
 * Rate limit: 300 req/min
 */
export async function getTokenPairs(tokenAddress: string, chain: string = "solana"): Promise<DexScreenerPair[]> {
    await pairLimiter.acquire();

    const url = `${DEXSCREENER_API}/token-pairs/v1/${chain}/${tokenAddress}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`DexScreener returned ${res.status}`);
        }

        const data = await res.json() as DexScreenerPair[];
        return Array.isArray(data) ? data : [];
    } catch (error) {
        logger.warn({ tokenAddress, error: String(error) }, "DexScreener getTokenPairs failed");
        return [];
    }
}

/**
 * Batch query: get pairs for multiple token addresses (max 30 per call).
 * Rate limit: 300 req/min
 */
export async function getTokensBatch(tokenAddresses: string[], chain: string = "solana"): Promise<DexScreenerPair[]> {
    if (tokenAddresses.length === 0) return [];
    if (tokenAddresses.length > 30) {
        logger.warn({ count: tokenAddresses.length }, "DexScreener batch limited to 30, truncating");
        tokenAddresses = tokenAddresses.slice(0, 30);
    }

    await pairLimiter.acquire();

    const addressList = tokenAddresses.join(",");
    const url = `${DEXSCREENER_API}/tokens/v1/${chain}/${addressList}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`DexScreener returned ${res.status}`);
        }

        const data = await res.json() as DexScreenerPair[];
        return Array.isArray(data) ? data : [];
    } catch (error) {
        logger.warn({ error: String(error) }, "DexScreener getTokensBatch failed");
        return [];
    }
}

/**
 * Get detail for a specific pair by chain and pair address.
 * Rate limit: 300 req/min
 */
export async function getPairDetail(pairAddress: string, chain: string = "solana"): Promise<DexScreenerPair | null> {
    await pairLimiter.acquire();

    const url = `${DEXSCREENER_API}/latest/dex/pairs/${chain}/${pairAddress}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`DexScreener returned ${res.status}`);
        }

        const json = await res.json() as { pairs?: DexScreenerPair[] };
        return json.pairs?.[0] ?? null;
    } catch (error) {
        logger.warn({ pairAddress, error: String(error) }, "DexScreener getPairDetail failed");
        return null;
    }
}

/**
 * Search for pairs matching a query (token name, symbol, or address).
 * Rate limit: 300 req/min
 */
export async function searchDexScreener(query: string): Promise<DexScreenerPair[]> {
    await pairLimiter.acquire();

    const url = `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`DexScreener returned ${res.status}`);
        }

        const json = await res.json() as { pairs?: DexScreenerPair[] };
        return json.pairs ?? [];
    } catch (error) {
        logger.warn({ query, error: String(error) }, "DexScreener search failed");
        return [];
    }
}

/**
 * Get currently boosted tokens.
 * Rate limit: 60 req/min
 */
export async function getBoostedTokens(): Promise<DexScreenerBoost[]> {
    await boostLimiter.acquire();

    const url = `${DEXSCREENER_API}/token-boosts/latest/v1`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`DexScreener returned ${res.status}`);
        }

        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        logger.warn({ error: String(error) }, "DexScreener getBoostedTokens failed");
        return [];
    }
}

/**
 * Get tokens with most active boosts.
 * Rate limit: 60 req/min
 */
export async function getTopBoostedTokens(): Promise<DexScreenerBoost[]> {
    await boostLimiter.acquire();

    const url = `${DEXSCREENER_API}/token-boosts/top/v1`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`DexScreener returned ${res.status}`);
        }

        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        logger.warn({ error: String(error) }, "DexScreener getTopBoostedTokens failed");
        return [];
    }
}

// ─── Helper: Extract market data from pair ─────────────────────────

export interface DexScreenerMarketData {
    priceUsd: number;
    priceChange5m: number;
    priceChange1h: number;
    priceChange6h: number;
    priceChange24h: number;
    buys5m: number;
    sells5m: number;
    buys1h: number;
    sells1h: number;
    buys24h: number;
    sells24h: number;
    buySellRatio24h: number;
    volume24h: number;
    liquidityUsd: number;
    fdv: number;
    marketCap: number;
    pairCreatedAt: number;
    pairAgeHours: number;
    isBoosted: boolean;
    boostAmount: number;
    dexId: string;
    pairAddress: string;
}

export function extractMarketData(pair: DexScreenerPair, boostedTokens?: Set<string>): DexScreenerMarketData {
    const buys24h = pair.txns?.h24?.buys ?? 0;
    const sells24h = pair.txns?.h24?.sells ?? 0;
    const totalTxns24h = buys24h + sells24h;

    const pairAgeMs = Date.now() - (pair.pairCreatedAt || Date.now());
    const pairAgeHours = Math.max(0, pairAgeMs / (1000 * 60 * 60));

    const tokenAddress = pair.baseToken?.address ?? "";
    const isBoosted = boostedTokens?.has(tokenAddress) ?? (pair.boosts?.active ?? 0) > 0;

    return {
        priceUsd: parseFloat(pair.priceUsd) || 0,
        priceChange5m: pair.priceChange?.m5 ?? 0,
        priceChange1h: pair.priceChange?.h1 ?? 0,
        priceChange6h: pair.priceChange?.h6 ?? 0,
        priceChange24h: pair.priceChange?.h24 ?? 0,
        buys5m: pair.txns?.m5?.buys ?? 0,
        sells5m: pair.txns?.m5?.sells ?? 0,
        buys1h: pair.txns?.h1?.buys ?? 0,
        sells1h: pair.txns?.h1?.sells ?? 0,
        buys24h,
        sells24h,
        buySellRatio24h: totalTxns24h > 0 ? buys24h / (sells24h || 1) : 0,
        volume24h: pair.volume?.h24 ?? 0,
        liquidityUsd: pair.liquidity?.usd ?? 0,
        fdv: pair.fdv ?? 0,
        marketCap: pair.marketCap ?? 0,
        pairCreatedAt: pair.pairCreatedAt ?? 0,
        pairAgeHours,
        isBoosted,
        boostAmount: pair.boosts?.active ?? 0,
        dexId: pair.dexId ?? "",
        pairAddress: pair.pairAddress ?? "",
    };
}
