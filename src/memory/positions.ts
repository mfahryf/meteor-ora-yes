// src/memory/positions.ts
import { getDb } from "./sqlite";

export interface PositionRecord {
    position_pubkey: string;
    pool_address: string;
    strategy_type: string;
    bin_step: number;
    min_bin: number;
    max_bin: number;
    amount_x: number;
    amount_y: number;
    status: string;
}

export function insertPosition(pos: PositionRecord) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO positions (
            position_pubkey, pool_address, strategy_type, bin_step,
            min_bin, max_bin, amount_x, amount_y, status, opened_at
        ) VALUES ($pubkey, $pool, $strat, $step, $min, $max, $amtx, $amty, $status, CURRENT_TIMESTAMP)
    `);

    stmt.run({
        $pubkey: pos.position_pubkey,
        $pool: pos.pool_address,
        $strat: pos.strategy_type,
        $step: pos.bin_step,
        $min: pos.min_bin,
        $max: pos.max_bin,
        $amtx: pos.amount_x,
        $amty: pos.amount_y,
        $status: pos.status
    });
}

export function getOpenPositions(): PositionRecord[] {
    const db = getDb();
    const stmt = db.prepare(`SELECT * FROM positions WHERE status = 'open'`);
    return stmt.all() as PositionRecord[];
}

export function updatePositionStatus(positionPubkey: string, status: string): void {
    const db = getDb();
    const stmt = db.prepare(`UPDATE positions SET status = $status, closed_at = CURRENT_TIMESTAMP WHERE position_pubkey = $pubkey`);
    stmt.run({ $status: status, $pubkey: positionPubkey });
}
