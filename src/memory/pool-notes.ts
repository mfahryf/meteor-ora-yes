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
