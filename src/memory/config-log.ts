// src/memory/config-log.ts
import { getDb } from "./sqlite";

export interface ConfigLogRecord {
    id?: number;
    key: string;
    old_value: string;
    new_value: string;
    reason: string;
    agent_type: string;
    timestamp?: string;
}

export function insertConfigLog(entry: ConfigLogRecord): void {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO config_log (key, old_value, new_value, reason, agent_type)
        VALUES ($key, $old, $new, $reason, $type)
    `);
    stmt.run({
        $key: entry.key,
        $old: entry.old_value,
        $new: entry.new_value,
        $reason: entry.reason,
        $type: entry.agent_type,
    });
}

export function getConfigHistory(limit: number = 20): ConfigLogRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM config_log ORDER BY timestamp DESC LIMIT $limit`)
        .all({ $limit: limit }) as ConfigLogRecord[];
}

export function getConfigHistoryForKey(key: string): ConfigLogRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM config_log WHERE key = $key ORDER BY timestamp DESC`)
        .all({ $key: key }) as ConfigLogRecord[];
}
