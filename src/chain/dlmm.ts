// src/chain/dlmm.ts
import BN from 'bn.js';
import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface PositionParams {
  poolAddress: string;
  binStep: number;
  minBin: number;
  maxBin: number;
  amountX: number;
  amountY: number;
  strategyType: string;
}

export async function getDlmmPool(connection: Connection, poolAddress: string): Promise<DLMM> {
    try {
        return await DLMM.create(connection, new PublicKey(poolAddress));
    } catch (error) {
        throw new Error(`Failed to load DLMM pool ${poolAddress}: ${error instanceof Error ? error.message : error}`);
    }
}

export async function getActiveBin(connection: Connection, poolAddress: string) {
    const pool = await getDlmmPool(connection, poolAddress);
    const activeBin = pool.activeBin;
    return {
        binId: activeBin.binId,
        price: activeBin.price,
        pricePerToken: activeBin.price,
    };
}

export async function deployPosition(
    connection: Connection,
    wallet: Keypair,
    params: PositionParams
) {
    const pool = await getDlmmPool(connection, params.poolAddress);

    const totalBinRange = params.maxBin - params.minBin + 1;
    const bins = Array.from({ length: totalBinRange }, (_, i) => {
        const binId = params.minBin + i;
        return {
            binId,
            xAmountBPS: params.strategyType === 'spot' ? 100 : 50,
            yAmountBPS: params.strategyType === 'spot' ? 0 : 50,
        };
    });

    try {
        const { transactions, position } = await pool.initializePositionAndAddLiquidityByWeight({
            positionKeypair: Keypair.generate(),
            user: wallet.publicKey,
            totalXAmount: new BN(params.amountX),
            totalYAmount: new BN(params.amountY),
            bins,
        });

        const txSig = await sendAndConfirm(connection, transactions, wallet);
        logger.info({ pool: params.poolAddress, txSig }, "Position deployed");

        return {
            positionPubkey: position.publicKey.toBase58(),
            txSignature: txSig,
        };
    } catch (error) {
        throw new Error(`Failed to deploy position: ${error instanceof Error ? error.message : error}`);
    }
}

export async function closePosition(
    connection: Connection,
    wallet: Keypair,
    positionPubkey: string,
    poolAddress: string
) {
    const pool = await getDlmmPool(connection, poolAddress);
    try {
        const { transactions } = await pool.withdrawAll({
            owner: wallet.publicKey,
            position: new PublicKey(positionPubkey),
        });

        const txSig = await sendAndConfirm(connection, transactions, wallet);
        logger.info({ positionPubkey, txSig }, "Position closed");

        return { txSignature: txSig };
    } catch (error) {
        throw new Error(`Failed to close position ${positionPubkey}: ${error instanceof Error ? error.message : error}`);
    }
}

export async function claimFees(
    connection: Connection,
    wallet: Keypair,
    positionPubkey: string,
    poolAddress: string
) {
    const pool = await getDlmmPool(connection, poolAddress);
    try {
        const { transactions } = await pool.claimAllFee({
            owner: wallet.publicKey,
            position: new PublicKey(positionPubkey),
        });

        const txSig = await sendAndConfirm(connection, transactions, wallet);
        logger.info({ positionPubkey, txSig }, "Fees claimed");

        return { txSignature: txSig };
    } catch (error) {
        throw new Error(`Failed to claim fees for ${positionPubkey}: ${error instanceof Error ? error.message : error}`);
    }
}

async function sendAndConfirm(
    connection: Connection,
    transactions: Transaction[],
    wallet: Keypair
): Promise<string> {
    let lastSig = "";
    for (const tx of transactions) {
        tx.partialSign(wallet);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
        });
        await connection.confirmTransaction(sig, "confirmed");
        lastSig = sig;
    }
    return lastSig;
}
