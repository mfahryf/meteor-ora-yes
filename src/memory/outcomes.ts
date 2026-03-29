// src/memory/outcomes.ts
// Position outcome tracking — links positions to their final results
// Enables EVOLVER to analyze: which strategies, pool types, and conditions produce the best PnL

import { getDb } from "./sqlite";
import { logger } from "../utils/logger";

// ─── Types ─────────────────────────────────────────────────────────

export interface PositionOutcome {
    id?: number;
    position_pubkey: string;
    pool_address: string;
    strategy_type: string;
    token_symbol: string;

    // Entry context
    entry_amount_sol: number;
    entry_timestamp: string;

    // Exit
    exit_amount_sol: number;
    exit_timestamp?: string;

    // Fees accumulated
    fees_earned_sol: number;

    // Results
    pnl_sol: number;
    pnl_pct: number;
    duration_minutes: number;
    exit_reason: string; // "take_profit" | "stop_loss" | "oor_timeout" | "manual" | "emergency"

    // Pool context at entry (for learning correlation)
    pool_tvl_at_entry: number;
    pool_volume_at_entry: number;
    pool_age_hours_at_entry: number;
    price_change_1h_at_entry: number;
    bin_step: number;
}

// ─── CRUD ──────────────────────────────────────────────────────────

export function insertOutcome(outcome: Omit<PositionOutcome, "id">): void {
    const db = getDb();
    db.prepare(`
        INSERT INTO position_outcomes (
            position_pubkey, pool_address, strategy_type, token_symbol,
            entry_amount_sol, entry_timestamp,
            exit_amount_sol, exit_timestamp,
            fees_earned_sol, pnl_sol, pnl_pct, duration_minutes, exit_reason,
            pool_tvl_at_entry, pool_volume_at_entry, pool_age_hours_at_entry,
            price_change_1h_at_entry, bin_step
        ) VALUES (
            $pubkey, $pool, $strategy, $token,
            $entrySol, $entryTs,
            $exitSol, $exitTs,
            $fees, $pnlSol, $pnlPct, $duration, $exitReason,
            $tvl, $volume, $age, $priceChange, $binStep
        )
    `).run({
        $pubkey: outcome.position_pubkey,
        $pool: outcome.pool_address,
        $strategy: outcome.strategy_type,
        $token: outcome.token_symbol,
        $entrySol: outcome.entry_amount_sol,
        $entryTs: outcome.entry_timestamp,
        $exitSol: outcome.exit_amount_sol,
        $exitTs: outcome.exit_timestamp || new Date().toISOString(),
        $fees: outcome.fees_earned_sol,
        $pnlSol: outcome.pnl_sol,
        $pnlPct: outcome.pnl_pct,
        $duration: outcome.duration_minutes,
        $exitReason: outcome.exit_reason,
        $tvl: outcome.pool_tvl_at_entry,
        $volume: outcome.pool_volume_at_entry,
        $age: outcome.pool_age_hours_at_entry,
        $priceChange: outcome.price_change_1h_at_entry,
        $binStep: outcome.bin_step,
    });

    logger.info({
        position: outcome.position_pubkey,
        strategy: outcome.strategy_type,
        pnlPct: outcome.pnl_pct,
        exitReason: outcome.exit_reason,
    }, "Position outcome recorded");
}

export function updateOutcomeFees(positionPubkey: string, additionalFees: number): void {
    const db = getDb();
    db.prepare(`
        UPDATE position_outcomes SET fees_earned_sol = fees_earned_sol + $fees
        WHERE position_pubkey = $pubkey AND exit_timestamp IS NULL
    `).run({ $pubkey: positionPubkey, $fees: additionalFees });
}

export function getOutcomeByPosition(positionPubkey: string): PositionOutcome | null {
    const db = getDb();
    return db.prepare(
        `SELECT * FROM position_outcomes WHERE position_pubkey = $pubkey`
    ).get({ $pubkey: positionPubkey }) as PositionOutcome | null;
}

export function getRecentOutcomes(limit: number = 50): PositionOutcome[] {
    const db = getDb();
    return db.prepare(
        `SELECT * FROM position_outcomes ORDER BY exit_timestamp DESC LIMIT $limit`
    ).all({ $limit: limit }) as PositionOutcome[];
}

export function getOutcomesByStrategy(strategyType: string, limit: number = 50): PositionOutcome[] {
    const db = getDb();
    return db.prepare(
        `SELECT * FROM position_outcomes WHERE strategy_type = $strategy ORDER BY exit_timestamp DESC LIMIT $limit`
    ).all({ $strategy: strategyType }) as PositionOutcome[];
}

export function getOutcomesByDateRange(startDate: string, endDate: string): PositionOutcome[] {
    const db = getDb();
    return db.prepare(
        `SELECT * FROM position_outcomes WHERE exit_timestamp >= $start AND exit_timestamp <= $end ORDER BY exit_timestamp DESC`
    ).all({ $start: startDate, $end: endDate }) as PositionOutcome[];
}
