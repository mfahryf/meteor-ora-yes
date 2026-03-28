// src/chain/wallet-balances.ts
// Wallet balances via Helius API — USD values per token, total portfolio

import { logger } from '../utils/logger';

const HELIUS_API = 'https://api.helius.xyz/v0';

function getHeliusApiKey(): string {
    const key = process.env.HELIUS_API_KEY;
    if (!key) throw new Error('HELIUS_API_KEY not set');
    return key;
}

export interface TokenBalance {
    mint: string;
    symbol: string;
    amount: number;
    decimals: number;
    priceUsd: number;
    valueUsd: number;
}

export interface WalletBalances {
    publicKey: string;
    sol: number;
    solValueUsd: number;
    tokens: TokenBalance[];
    totalValueUsd: number;
}

export async function getWalletBalances(publicKey: string): Promise<WalletBalances> {
    const apiKey = getHeliusApiKey();

    try {
        const res = await fetch(`${HELIUS_API}/addresses/${publicKey}/balances?api-key=${apiKey}`);
        if (!res.ok) throw new Error(`Helius returned ${res.status}`);

        const data = await res.json() as any;

        // Parse SOL balance
        const solRaw = data.nativeBalance ?? 0;
        const sol = solRaw / 1e9;

        // Parse token balances
        const tokens: TokenBalance[] = (data.tokens || []).map((t: any) => {
            const amount = Number(t.amount ?? 0) / Math.pow(10, t.decimals ?? 0);
            const priceUsd = Number(t.pricePerToken ?? 0);
            const valueUsd = amount * priceUsd;
            return {
                mint: t.mint ?? '',
                symbol: t.symbol ?? '',
                amount,
                decimals: t.decimals ?? 0,
                priceUsd,
                valueUsd,
            };
        }).filter((t: TokenBalance) => t.amount > 0);

        // Calculate totals
        const solValueUsd = Number(data.nativeBalanceUsd ?? 0);
        const tokenValueUsd = tokens.reduce((sum: number, t: TokenBalance) => sum + t.valueUsd, 0);
        const totalValueUsd = solValueUsd + tokenValueUsd;

        return { publicKey, sol, solValueUsd, tokens, totalValueUsd };
    } catch (error) {
        logger.warn({ error: String(error), publicKey }, 'Helius wallet balance fetch failed');
        throw new Error(`Failed to fetch wallet balances: ${error instanceof Error ? error.message : error}`);
    }
}
