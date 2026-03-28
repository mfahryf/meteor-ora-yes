// src/memory/blacklist.ts
import { getDb } from "./sqlite";

export interface BlacklistEntry {
    id?: number;
    tokenMint: string;
    reason: string;
    addedAt?: string;
}

export function addToBlacklist(tokenMint: string, reason: string = ""): void {
    const db = getDb();
    db.prepare(`
        INSERT INTO blacklist (token_mint, reason)
        VALUES ($mint, $reason)
        ON CONFLICT(token_mint) DO UPDATE SET reason = $reason
    `).run({ $mint: tokenMint, $reason: reason });
}

export function removeFromBlacklist(tokenMint: string): boolean {
    const db = getDb();
    const result = db.prepare("DELETE FROM blacklist WHERE token_mint = $mint").run({ $mint: tokenMint });
    return result.changes > 0;
}

export function listBlacklist(): BlacklistEntry[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM blacklist ORDER BY added_at DESC").all() as any[];
    return rows.map(row => ({
        id: row.id,
        tokenMint: row.token_mint,
        reason: row.reason || "",
        addedAt: row.added_at,
    }));
}

export function isBlacklisted(tokenMint: string): boolean {
    const db = getDb();
    const row = db.prepare("SELECT 1 FROM blacklist WHERE token_mint = $mint").get({ $mint: tokenMint });
    return !!row;
}
