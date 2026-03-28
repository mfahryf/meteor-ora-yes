// src/chain/connection.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../utils/logger";

let connection: Connection | null = null;

export function getConnection(rpcUrl?: string): Connection {
    if (!connection) {
        if (!rpcUrl) throw new Error("Connection not initialized and no rpcUrl provided");
        connection = new Connection(rpcUrl, {
            commitment: "confirmed",
            disableRetryOnRateLimit: false,
        });
    }
    return connection;
}

export async function getSolBalance(publicKey: string | PublicKey): Promise<number> {
    const conn = getConnection();
    const pk = typeof publicKey === "string" ? new PublicKey(publicKey) : publicKey;
    const balance = await conn.getBalance(pk);
    return balance / 1e9; // lamports to SOL
}

export async function getTokenBalances(publicKey: string | PublicKey): Promise<Record<string, number>> {
    const conn = getConnection();
    const pk = typeof publicKey === "string" ? new PublicKey(publicKey) : publicKey;

    try {
        const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pk, {
            programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        });

        const balances: Record<string, number> = {};
        for (const { account } of tokenAccounts.value) {
            const parsed = (account.data as any).parsed?.info;
            if (parsed && parsed.tokenAmount?.uiAmount > 0) {
                balances[parsed.mint] = parsed.tokenAmount.uiAmount;
            }
        }
        return balances;
    } catch (error) {
        logger.warn({ error: String(error) }, "Failed to fetch token balances");
        return {};
    }
}

export function resetConnection(): void {
    connection = null;
}
