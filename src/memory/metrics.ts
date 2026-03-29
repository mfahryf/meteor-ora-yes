// src/memory/metrics.ts
// Computed performance metrics from position_outcomes table
// These give EVOLVER hard data instead of having to analyze raw trades

import { getDb } from "./sqlite";
import { logger } from "../utils/logger";

// ─── Types ─────────────────────────────────────────────────────────

export interface PerformanceMetrics {
    totalPositions: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;           // 0-100
    avgPnlPct: number;
    totalPnlSol: number;
    totalFeesEarnedSol: number;
    avgDurationMinutes: number;
    bestPnlPct: number;
    worstPnlPct: number;
    sharpeRatio: number;
}

export interface StrategyMetrics {
    strategyType: string;
    count: number;
    winRate: number;
    avgPnlPct: number;
    totalPnlSol: number;
    avgDurationMinutes: number;
}

export interface PoolProfileMetrics {
    tvlRange: string;
    count: number;
    winRate: number;
    avgPnlPct: number;
}

export interface DrawdownInfo {
    maxDrawdownPct: number;
    currentDrawdownPct: number;
    peakPnlSol: number;
    currentPnlSol: number;
}

// ─── Core Metrics ──────────────────────────────────────────────────

export function getPerformanceMetrics(days?: number): PerformanceMetrics {
    const db = getDb();
    const dateFilter = days
        ? `WHERE exit_timestamp >= datetime('now', '-${days} days')`
        : "";

    try {
        const rows = db.prepare(
            `SELECT pnl_pct, pnl_sol, fees_earned_sol, duration_minutes FROM position_outcomes ${dateFilter}`
        ).all() as Array<{ pnl_pct: number; pnl_sol: number; fees_earned_sol: number; duration_minutes: number }>;

        if (rows.length === 0) {
            return {
                totalPositions: 0, totalWins: 0, totalLosses: 0,
                winRate: 0, avgPnlPct: 0, totalPnlSol: 0, totalFeesEarnedSol: 0,
                avgDurationMinutes: 0, bestPnlPct: 0, worstPnlPct: 0, sharpeRatio: 0,
            };
        }

        const wins = rows.filter(r => r.pnl_pct > 0);
        const losses = rows.filter(r => r.pnl_pct <= 0);
        const pnlValues = rows.map(r => r.pnl_pct);
        const avgPnl = pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length;

        // Sharpe ratio (annualized, simplified)
        const stdDev = Math.sqrt(
            pnlValues.reduce((sum, p) => sum + Math.pow(p - avgPnl, 2), 0) / pnlValues.length
        );
        const sharpe = stdDev > 0 ? avgPnl / stdDev : 0;

        return {
            totalPositions: rows.length,
            totalWins: wins.length,
            totalLosses: losses.length,
            winRate: (wins.length / rows.length) * 100,
            avgPnlPct: avgPnl,
            totalPnlSol: rows.reduce((sum, r) => sum + r.pnl_sol, 0),
            totalFeesEarnedSol: rows.reduce((sum, r) => sum + r.fees_earned_sol, 0),
            avgDurationMinutes: rows.reduce((sum, r) => sum + r.duration_minutes, 0) / rows.length,
            bestPnlPct: Math.max(...pnlValues),
            worstPnlPct: Math.min(...pnlValues),
            sharpeRatio: sharpe,
        };
    } catch (error) {
        logger.warn({ error: String(error) }, "Failed to compute performance metrics");
        return {
            totalPositions: 0, totalWins: 0, totalLosses: 0,
            winRate: 0, avgPnlPct: 0, totalPnlSol: 0, totalFeesEarnedSol: 0,
            avgDurationMinutes: 0, bestPnlPct: 0, worstPnlPct: 0, sharpeRatio: 0,
        };
    }
}

// ─── Per-strategy Metrics ──────────────────────────────────────────

export function getStrategyMetrics(days?: number): StrategyMetrics[] {
    const db = getDb();
    const dateFilter = days
        ? `WHERE exit_timestamp >= datetime('now', '-${days} days')`
        : "";

    try {
        const rows = db.prepare(`
            SELECT 
                strategy_type,
                COUNT(*) as count,
                AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_pct) as avg_pnl_pct,
                SUM(pnl_sol) as total_pnl_sol,
                AVG(duration_minutes) as avg_duration
            FROM position_outcomes ${dateFilter}
            GROUP BY strategy_type
            ORDER BY avg_pnl_pct DESC
        `).all() as any[];

        return rows.map(r => ({
            strategyType: r.strategy_type,
            count: r.count,
            winRate: r.win_rate || 0,
            avgPnlPct: r.avg_pnl_pct || 0,
            totalPnlSol: r.total_pnl_sol || 0,
            avgDurationMinutes: r.avg_duration || 0,
        }));
    } catch (error) {
        logger.warn({ error: String(error) }, "Failed to compute strategy metrics");
        return [];
    }
}

// ─── Best/Worst Strategy ───────────────────────────────────────────

export function getBestStrategy(days: number = 30): StrategyMetrics | null {
    const metrics = getStrategyMetrics(days);
    // Require at least 3 positions to be statistically meaningful
    const qualified = metrics.filter(m => m.count >= 3);
    return qualified.length > 0 ? qualified[0] : null; // already sorted by avgPnlPct
}

export function getWorstStrategy(days: number = 30): StrategyMetrics | null {
    const metrics = getStrategyMetrics(days);
    const qualified = metrics.filter(m => m.count >= 3);
    return qualified.length > 0 ? qualified[qualified.length - 1] : null;
}

// ─── Pool Profile Analysis ─────────────────────────────────────────

export function getPoolProfileMetrics(days?: number): PoolProfileMetrics[] {
    const db = getDb();
    const dateFilter = days
        ? `WHERE exit_timestamp >= datetime('now', '-${days} days')`
        : "";

    try {
        const rows = db.prepare(`
            SELECT 
                CASE 
                    WHEN pool_tvl_at_entry < 10000 THEN '<$10K'
                    WHEN pool_tvl_at_entry < 50000 THEN '$10K-$50K'
                    WHEN pool_tvl_at_entry < 100000 THEN '$50K-$100K'
                    WHEN pool_tvl_at_entry < 500000 THEN '$100K-$500K'
                    ELSE '>$500K'
                END as tvl_range,
                COUNT(*) as count,
                AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate,
                AVG(pnl_pct) as avg_pnl_pct
            FROM position_outcomes ${dateFilter}
            GROUP BY tvl_range
            ORDER BY avg_pnl_pct DESC
        `).all() as any[];

        return rows.map(r => ({
            tvlRange: r.tvl_range,
            count: r.count,
            winRate: r.win_rate || 0,
            avgPnlPct: r.avg_pnl_pct || 0,
        }));
    } catch (error) {
        logger.warn({ error: String(error) }, "Failed to compute pool profile metrics");
        return [];
    }
}

// ─── Drawdown ──────────────────────────────────────────────────────

export function getDrawdown(days: number = 30): DrawdownInfo {
    const db = getDb();

    try {
        const rows = db.prepare(`
            SELECT pnl_sol FROM position_outcomes
            WHERE exit_timestamp >= datetime('now', '-${days} days')
            ORDER BY exit_timestamp ASC
        `).all() as Array<{ pnl_sol: number }>;

        if (rows.length === 0) {
            return { maxDrawdownPct: 0, currentDrawdownPct: 0, peakPnlSol: 0, currentPnlSol: 0 };
        }

        let cumulativePnl = 0;
        let peakPnl = 0;
        let maxDrawdown = 0;

        for (const row of rows) {
            cumulativePnl += row.pnl_sol;
            if (cumulativePnl > peakPnl) peakPnl = cumulativePnl;
            const drawdown = peakPnl > 0 ? ((peakPnl - cumulativePnl) / peakPnl) * 100 : 0;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }

        const currentDrawdown = peakPnl > 0
            ? ((peakPnl - cumulativePnl) / peakPnl) * 100
            : 0;

        return {
            maxDrawdownPct: maxDrawdown,
            currentDrawdownPct: currentDrawdown,
            peakPnlSol: peakPnl,
            currentPnlSol: cumulativePnl,
        };
    } catch (error) {
        logger.warn({ error: String(error) }, "Failed to compute drawdown");
        return { maxDrawdownPct: 0, currentDrawdownPct: 0, peakPnlSol: 0, currentPnlSol: 0 };
    }
}

// ─── Exit Reason Analysis ──────────────────────────────────────────

export interface ExitReasonMetrics {
    exitReason: string;
    count: number;
    avgPnlPct: number;
    winRate: number;
}

export function getExitReasonMetrics(days?: number): ExitReasonMetrics[] {
    const db = getDb();
    const dateFilter = days
        ? `WHERE exit_timestamp >= datetime('now', '-${days} days')`
        : "";

    try {
        const rows = db.prepare(`
            SELECT
                exit_reason,
                COUNT(*) as count,
                AVG(pnl_pct) as avg_pnl_pct,
                AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END) * 100 as win_rate
            FROM position_outcomes ${dateFilter}
            GROUP BY exit_reason
            ORDER BY count DESC
        `).all() as any[];

        return rows.map(r => ({
            exitReason: r.exit_reason,
            count: r.count,
            avgPnlPct: r.avg_pnl_pct || 0,
            winRate: r.win_rate || 0,
        }));
    } catch (error) {
        logger.warn({ error: String(error) }, "Failed to compute exit reason metrics");
        return [];
    }
}

// ─── All-in-one for EVOLVER ────────────────────────────────────────

export interface ComputedMetrics {
    overall: PerformanceMetrics;
    byStrategy: StrategyMetrics[];
    byPoolProfile: PoolProfileMetrics[];
    byExitReason: ExitReasonMetrics[];
    drawdown: DrawdownInfo;
    bestStrategy: StrategyMetrics | null;
    worstStrategy: StrategyMetrics | null;
}

export function getAllComputedMetrics(days: number = 30): ComputedMetrics {
    return {
        overall: getPerformanceMetrics(days),
        byStrategy: getStrategyMetrics(days),
        byPoolProfile: getPoolProfileMetrics(days),
        byExitReason: getExitReasonMetrics(days),
        drawdown: getDrawdown(days),
        bestStrategy: getBestStrategy(days),
        worstStrategy: getWorstStrategy(days),
    };
}
