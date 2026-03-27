// src/chain/dlmm.ts
import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey } from '@solana/web3.js';

export async function getDlmmPool(connection: Connection, poolAddress: string) {
    return await DLMM.create(connection, new PublicKey(poolAddress));
}
