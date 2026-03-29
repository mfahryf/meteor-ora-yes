// src/memory/pool-notes.ts
import { getDb } from "./sqlite";

export interface PoolNote {
    id?: number;
    poolAddress: string;
    note: string;
    agentType: string;
    createdAt?: string;
}

export function addPoolNote(poolAddress: string, note: string, agentType: string = ""): void {
    const db = getDb();
    db.prepare(`
        INSERT INTO pool_notes (pool_address, note, agent_type)
        VALUES ($pool, $note, $agent)
    `).run({ $pool: poolAddress, $note: note, $agent: agentType });
}

export function getPoolNotes(poolAddress: string, limit: number = 20): PoolNote[] {
    const db = getDb();
    const rows = db.prepare(
        "SELECT * FROM pool_notes WHERE pool_address = $pool ORDER BY created_at DESC LIMIT $limit"
    ).all({ $pool: poolAddress, $limit: limit }) as any[];
    return rows.map(row => ({
        id: row.id,
        poolAddress: row.pool_address,
        note: row.note,
        agentType: row.agent_type || "",
        createdAt: row.created_at,
    }));
}

/**
 * Get the most recent instruction note for a position (set via /set command).
 * Instructions are prefixed with [INSTRUCTION].
 */
export function getPoolInstruction(poolAddress: string): string | null {
    const db = getDb();
    const row = db.prepare(
        `SELECT note FROM pool_notes WHERE pool_address = $pool AND note LIKE '[INSTRUCTION]%' ORDER BY created_at DESC LIMIT 1`
    ).get({ $pool: poolAddress }) as { note: string } | null;
    return row?.note?.replace("[INSTRUCTION] ", "") ?? null;
}

/**
 * Clear all notes for a pool (called when position is closed).
 */
export function clearPoolNotes(poolAddress: string): number {
    const db = getDb();
    const result = db.prepare(`DELETE FROM pool_notes WHERE pool_address = $pool`).run({ $pool: poolAddress });
    return result.changes;
}
