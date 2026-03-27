// src/chain/connection.ts
import { Connection } from "@solana/web3.js";

let connection: Connection | null = null;

export function getConnection(rpcUrl: string): Connection {
    if (!connection) {
        connection = new Connection(rpcUrl, {
            commitment: "confirmed",
            disableRetryOnRateLimit: false,
        });
    }
    return connection;
}
