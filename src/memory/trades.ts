// src/memory/trades.ts
import { getDb } from "./sqlite";

export interface TradeRecord {
    id?: number;
    position_pubkey: string;
    pool_address: string;
    token_a: string;
    token_b: string;
    action: string;
    amount_sol: number;
    amount_token: number;
    tx_signature: string;
    timestamp?: string;
}

export function insertTrade(trade: TradeRecord): void {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO trades (position_pubkey, pool_address, token_a, token_b, action, amount_sol, amount_token, tx_signature)
        VALUES ($pubkey, $pool, $tokenA, $tokenB, $action, $amountSol, $amountToken, $txSig)
    `);
    stmt.run({
        $pubkey: trade.position_pubkey,
        $pool: trade.pool_address,
        $tokenA: trade.token_a,
        $tokenB: trade.token_b,
        $action: trade.action,
        $amountSol: trade.amount_sol,
        $amountToken: trade.amount_token,
        $txSig: trade.tx_signature,
    });
}

export function getTradesByPool(poolAddress: string): TradeRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM trades WHERE pool_address = $pool ORDER BY timestamp DESC`)
        .all({ $pool: poolAddress }) as TradeRecord[];
}

export function getTradesByPosition(positionPubkey: string): TradeRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM trades WHERE position_pubkey = $pubkey ORDER BY timestamp DESC`)
        .all({ $pubkey: positionPubkey }) as TradeRecord[];
}

export function getRecentTrades(limit: number = 20): TradeRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM trades ORDER BY timestamp DESC LIMIT $limit`)
        .all({ $limit: limit }) as TradeRecord[];
}
