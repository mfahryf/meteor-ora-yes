// src/chain/lpagent.ts
// Top LPer study via api.lpagent.io with key rotation
// Docs: https://docs.lpagent.io/api-reference/introduction

import { logger } from "../utils/logger";

const LPAGENT_API = "https://api.lpagent.io/open-api/v1";

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

const apiKeys = new KeyRotator("LPAGENT_API_KEY");

// ─── Types ─────────────────────────────────────────────────────────

export interface LPerProfile {
    address: string;
    totalPositions: number;
    avgHoldHours: number;
    avgWinRate: number;
    avgRoiPct: number;
    scalperCount: number;
    holderCount: number;
    totalPnlSol: number;
}

export interface TopLPerStudy {
    pool: string;
    totalLPers: number;
    credibleCount: number;
    topLPers: LPerProfile[];
    aggregate: {
        avgHoldHours: number;
        avgWinRate: number;
        avgRoiPct: number;
        scalperRatio: number;
    };
}

// ─── API calls ─────────────────────────────────────────────────────
// Auth: x-api-key header (not Bearer token)
// Docs: https://docs.lpagent.io/api-reference/pools/get-top-lpers-for-a-pool

async function lpagentFetch(path: string): Promise<any> {
    const key = apiKeys.next;
    if (!key) throw new Error("LPAGENT_API_KEY not set");

    const res = await fetch(`${LPAGENT_API}${path}`, {
        headers: { "x-api-key": key },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`LPAgent returned ${res.status}: ${body}`);
    }

    const json = await res.json() as any;
    // API wraps responses in { status: "success", data: ... }
    return json.data ?? json;
}

// ─── Public API ────────────────────────────────────────────────────

export async function studyTopLPers(poolAddress: string, limit: number = 10): Promise<TopLPerStudy> {
    if (!apiKeys.hasKeys) {
        return { pool: poolAddress, totalLPers: 0, credibleCount: 0, topLPers: [], aggregate: { avgHoldHours: 0, avgWinRate: 0, avgRoiPct: 0, scalperRatio: 0 } };
    }

    try {
        // 1. Get top LPers for pool
        // Docs: GET /pools/{poolId}/top-lpers?sort_order=desc&page=1&limit=20
        const data = await lpagentFetch(`/pools/${poolAddress}/top-lpers?sort_order=desc&page=1&limit=${limit}`);
        const lpers = Array.isArray(data) ? data : (data.lpers || data.data || []);

        // 2. Filter credible LPers (>= 3 positions, known win rate)
        const credible = lpers.filter((lp: any) => {
            const positions = lp.total_lp ?? lp.total_positions ?? lp.positionCount ?? 0;
            return positions >= 3;
        });

        // 3. Aggregate patterns from credible LPers
        // Response fields from docs: owner, total_pnl, total_pnl_native, avg_age_hour,
        //   win_rate, win_rate_native, roi, total_lp, apr, fee_percent
        const profiles: LPerProfile[] = credible.slice(0, limit).map((lp: any) => {
            const avgHold = lp.avg_age_hour ?? lp.avg_hold_hours ?? lp.avgHoldHours ?? 0;
            const winRate = lp.win_rate_native ?? lp.win_rate ?? lp.winRate ?? 0;
            const roi = lp.roi ?? lp.avg_roi_pct ?? lp.avgRoiPct ?? 0;
            const isScalper = avgHold < 24;

            return {
                address: lp.owner ?? lp.address ?? lp.wallet ?? "",
                totalPositions: lp.total_lp ?? lp.total_positions ?? lp.positionCount ?? 0,
                avgHoldHours: avgHold,
                avgWinRate: winRate,
                avgRoiPct: roi,
                scalperCount: isScalper ? 1 : 0,
                holderCount: isScalper ? 0 : 1,
                totalPnlSol: lp.total_pnl_native ?? lp.total_pnl_sol ?? lp.pnlSol ?? 0,
            };
        });

        // 4. Aggregate stats
        const count = profiles.length || 1;
        const aggregate = {
            avgHoldHours: profiles.reduce((s, p) => s + p.avgHoldHours, 0) / count,
            avgWinRate: profiles.reduce((s, p) => s + p.avgWinRate, 0) / count,
            avgRoiPct: profiles.reduce((s, p) => s + p.avgRoiPct, 0) / count,
            scalperRatio: profiles.reduce((s, p) => s + p.scalperCount, 0) / count,
        };

        return {
            pool: poolAddress,
            totalLPers: lpers.length,
            credibleCount: credible.length,
            topLPers: profiles,
            aggregate,
        };
    } catch (error) {
        logger.warn({ pool: poolAddress, error: String(error) }, "LPAgent study failed");
        return { pool: poolAddress, totalLPers: 0, credibleCount: 0, topLPers: [], aggregate: { avgHoldHours: 0, avgWinRate: 0, avgRoiPct: 0, scalperRatio: 0 } };
    }
}
