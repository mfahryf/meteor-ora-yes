// src/chain/token-research.ts
// Token research via Jupiter Datapi (primary) + Birdeye (fallback)
// Supports comma-separated JUPITER_DATAPI_KEY for key rotation

import { logger } from "../utils/logger";

const JUPITER_DATAPI = "https://datapi.jup.ag/v1";
const BIRDEYE_API = "https://public-api.birdeye.so";

// ─── Key Rotation ──────────────────────────────────────────────────

class KeyRotator {
    private keys: string[];
    private index = 0;

    constructor(envVar: string) {
        const raw = process.env[envVar] || "";
        this.keys = raw.split(",").map(k => k.trim()).filter(Boolean);
    }

    get next(): string | undefined {
        if (this.keys.length === 0) return undefined;
        const key = this.keys[this.index % this.keys.length];
        this.index++;
        return key;
    }

    get hasKeys(): boolean {
        return this.keys.length > 0;
    }
}

const datapiKeys = new KeyRotator("JUPITER_DATAPI_KEY");

function getBirdeyeApiKey(): string | undefined {
    return process.env.BIRDEYE_API_KEY;
}

// ─── Types ─────────────────────────────────────────────────────────

export interface TokenInfo {
    mint: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    tags?: string[];
    priceUsd?: number;
    marketCap?: number;
    volume24h?: number;
    organic?: number;
    audit?: string;
    stats1h?: { buys: number; sells: number; netBuyers: number; volumeSol: number };
    stats24h?: { buys: number; sells: number; netBuyers: number; volumeSol: number };
    globalFeesSol?: number;
}

export interface TokenHolderInfo {
    mint: string;
    holders: Array<{ address: string; amount: number; pct: number }>;
    topHolderPct: number;
    bundlerSignals?: string[];
}

export interface TokenNarrative {
    mint: string;
    symbol: string;
    narrative: string;
    sentiment: string;
    riskSignals: string[];
}

// ─── Datapi request helper ─────────────────────────────────────────

async function datapiFetch(path: string): Promise<any> {
    const key = datapiKeys.next;
    const headers: Record<string, string> = {};
    if (key) headers["x-datapi-key"] = key;

    const res = await fetch(`${JUPITER_DATAPI}${path}`, { headers });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Datapi returned ${res.status}: ${body}`);
    }
    return res.json();
}

// ─── getTokenInfo ──────────────────────────────────────────────────

export async function getTokenInfo(mint: string): Promise<TokenInfo> {
    // Try Jupiter Datapi first
    if (datapiKeys.hasKeys) {
        try {
            const data = await datapiFetch(`/tokens/${mint}/info`);
            const stats1h = data.stats_1h;
            const stats24h = data.stats_24h;
            return {
                mint,
                symbol: data.symbol || "",
                name: data.name || "",
                decimals: data.decimals || 0,
                logoURI: data.logoURI,
                tags: data.tags || [],
                priceUsd: data.price_usd,
                marketCap: data.market_cap,
                volume24h: data.volume_24h,
                organic: data.organic,
                audit: data.audit,
                stats1h: stats1h ? { buys: stats1h.buys, sells: stats1h.sells, netBuyers: stats1h.net_buyers, volumeSol: stats1h.volume_sol } : undefined,
                stats24h: stats24h ? { buys: stats24h.buys, sells: stats24h.sells, netBuyers: stats24h.net_buyers, volumeSol: stats24h.volume_sol } : undefined,
                globalFeesSol: data.global_fees_sol,
            };
        } catch {
            logger.warn({ mint }, "Jupiter Datapi lookup failed, trying fallback");
        }
    }

    // Fallback: Birdeye
    const birdeyeKey = getBirdeyeApiKey();
    if (birdeyeKey) {
        try {
            const res = await fetch(
                `${BIRDEYE_API}/defi/token_overview?address=${mint}`,
                { headers: { "X-API-KEY": birdeyeKey } }
            );
            if (res.ok) {
                const json = await res.json() as any;
                const data = json.data || {};
                return {
                    mint,
                    symbol: data.symbol || "",
                    name: data.name || "",
                    decimals: data.decimals || 0,
                    logoURI: data.logoURI,
                    priceUsd: data.price,
                    marketCap: data.mc,
                    volume24h: data.volumes?.h24,
                };
            }
        } catch {
            logger.warn({ mint }, "Birdeye token lookup failed");
        }
    }

    return { mint, symbol: "UNKNOWN", name: "", decimals: 0 };
}

// ─── getTokenHolders ───────────────────────────────────────────────

export async function getTokenHolders(mint: string, limit: number = 10): Promise<TokenHolderInfo> {
    // Try Jupiter Datapi first
    if (datapiKeys.hasKeys) {
        try {
            const data = await datapiFetch(`/tokens/${mint}/holders?limit=${limit}`);
            const items = (data.holders || data || []) as any[];
            const holders = items.slice(0, limit).map((h: any) => ({
                address: h.address || h.owner || "",
                amount: Number(h.amount || h.uiAmount || 0),
                pct: Number(h.pct || h.percentage || 0),
            }));
            const topHolderPct = holders.length > 0 ? holders[0].pct : 0;

            // Bundler detection signals
            const bundlerSignals: string[] = [];
            if (data.bundler_info) {
                const bi = data.bundler_info;
                if (bi.common_funder) bundlerSignals.push(`common_funder: ${bi.common_funder}`);
                if (bi.funded_same_window) bundlerSignals.push("funded_same_window");
            }

            return { mint, holders, topHolderPct, bundlerSignals: bundlerSignals.length > 0 ? bundlerSignals : undefined };
        } catch {
            logger.warn({ mint }, "Jupiter Datapi holders failed, trying fallback");
        }
    }

    // Fallback: Birdeye
    const birdeyeKey = getBirdeyeApiKey();
    if (birdeyeKey) {
        try {
            const res = await fetch(
                `${BIRDEYE_API}/defi/v3/token/holder?address=${mint}&limit=${limit}`,
                { headers: { "X-API-KEY": birdeyeKey } }
            );
            if (!res.ok) throw new Error(`Birdeye returned ${res.status}`);

            const json = await res.json() as any;
            const items = (json.data?.items || json.data || []) as any[];
            const holders = items.slice(0, limit).map((h: any) => ({
                address: h.address || h.owner || "",
                amount: Number(h.amount || h.uiAmount || 0),
                pct: Number(h.pct || h.percentage || 0),
            }));
            const topHolderPct = holders.length > 0 ? holders[0].pct : 0;

            return { mint, holders, topHolderPct };
        } catch (error) {
            logger.warn({ mint, error: String(error) }, "Token holders lookup failed");
        }
    }

    return { mint, holders: [], topHolderPct: 0 };
}

// ─── getTokenNarrative ─────────────────────────────────────────────

export async function getTokenNarrative(mint: string): Promise<TokenNarrative> {
    const info = await getTokenInfo(mint);
    const riskSignals: string[] = [];

    if (info.priceUsd && info.priceUsd < 0.001) riskSignals.push("sub-penny price");
    if (info.marketCap && info.marketCap < 10000) riskSignals.push("very low market cap");
    if (info.organic && info.organic < 30) riskSignals.push(`low organic score (${info.organic})`);

    const holders = await getTokenHolders(mint, 5);
    if (holders.topHolderPct > 50) riskSignals.push("top holder >50%");
    if (holders.topHolderPct > 80) riskSignals.push("top holder >80% - rug risk");
    if (holders.bundlerSignals?.length) riskSignals.push(`bundler: ${holders.bundlerSignals.join(", ")}`);

    let sentiment = "neutral";
    if (riskSignals.length >= 3) sentiment = "high risk";
    else if (riskSignals.length >= 1) sentiment = "caution";

    const narrative = riskSignals.length > 0
        ? `${info.symbol || mint}: ${riskSignals.join("; ")}`
        : `${info.symbol || mint}: no obvious risk signals detected`;

    return { mint, symbol: info.symbol, narrative, sentiment, riskSignals };
}
