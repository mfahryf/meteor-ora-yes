// src/memory/fees.ts
import { getDb } from "./sqlite";

export interface FeeClaimRecord {
    id?: number;
    position_pubkey: string;
    fee_a: number;
    fee_b: number;
    tx_signature: string;
    timestamp?: string;
}

export function insertFeeClaim(claim: FeeClaimRecord): void {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO fee_claims (position_pubkey, fee_a, fee_b, tx_signature)
        VALUES ($pubkey, $feeA, $feeB, $txSig)
    `);
    stmt.run({
        $pubkey: claim.position_pubkey,
        $feeA: claim.fee_a,
        $feeB: claim.fee_b,
        $txSig: claim.tx_signature,
    });
}

export function getFeeClaimsByPosition(positionPubkey: string): FeeClaimRecord[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM fee_claims WHERE position_pubkey = $pubkey ORDER BY timestamp DESC`)
        .all({ $pubkey: positionPubkey }) as FeeClaimRecord[];
}

export function getTotalFeesClaimed(): { totalFeeA: number; totalFeeB: number } {
    const db = getDb();
    const row = db.query(`SELECT COALESCE(SUM(fee_a), 0) as totalFeeA, COALESCE(SUM(fee_b), 0) as totalFeeB FROM fee_claims`)
        .get() as any;
    return { totalFeeA: row.totalFeeA, totalFeeB: row.totalFeeB };
}
