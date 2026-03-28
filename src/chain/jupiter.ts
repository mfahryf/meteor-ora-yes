// src/chain/jupiter.ts
// Jupiter Swap V2 API (primary) + Quote V6 API (fallback) for swaps
// Docs: https://dev.jup.ag/docs/swap/order-and-execute

import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { logger } from '../utils/logger';

const JUPITER_ULTRA_API = "https://api.jup.ag/ultra/v1";
const QUOTE_API = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

class KeyRotator {
    private keys: string[];
    private index = 0;

    constructor(envVar: string) {
        const raw = process.env[envVar] || "";
        this.keys = raw.split(",").map(k => k.trim()).filter(Boolean);
    }

    get next(): string | undefined {
        if (this.keys.length === 0) return undefined;
        const key = this.keys[this.index % this.keys.length];
        this.index++;
        return key;
    }

    get hasKeys(): boolean {
        return this.keys.length > 0;
    }
}

const jupiterApiKeys = new KeyRotator("JUPITER_API_KEY");

function getApiKey(): string | undefined {
    return jupiterApiKeys.next;
}

function normalizeMint(mint: string): string {
    if (
        mint === 'SOL' ||
        mint === 'sol' ||
        mint === 'native' ||
        /^So1+$/.test(mint) ||
        (mint.length >= 32 && mint.length <= 44 && mint.startsWith("So1"))
    ) return SOL_MINT;
    return mint;
}

export interface SwapResult {
    txSignature: string;
    inputMint: string;
    outputMint: string;
    inAmount: number;
    outAmount: number;
}

// ─── Primary path: Jupiter Ultra V1 (order + execute) ────────────────
// Uses exact amount parameter as required by Ultra API logic

async function swapUltra(
    connection: Connection,
    wallet: Keypair,
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
): Promise<SwapResult> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('JUPITER_API_KEY not set');

    // Convert raw "amount" into appropriately scaled integer string to match Ultra's requirements
    let decimals = 9;
    if (inputMint !== SOL_MINT) {
        try {
            const mintInfo = await connection.getParsedAccountInfo(new PublicKey(inputMint));
            decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 9;
        } catch {
            // default to 9 if failed to fetch
        }
    }
    const amountStr = Math.floor(amount * Math.pow(10, decimals)).toString();

    const headers: Record<string, string> = { 'x-api-key': apiKey };

    // 1. GET /order → unsigned transaction
    const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amountStr,
        slippageBps: String(slippageBps),
        taker: wallet.publicKey.toBase58(),
    });

    const orderRes = await fetch(`${JUPITER_ULTRA_API}/order?${params}`, { headers });
    if (!orderRes.ok) {
        const body = await orderRes.text();
        throw new Error(`Jupiter Ultra /order failed (${orderRes.status}): ${body}`);
    }

    const orderData = await orderRes.json() as any;
    if (orderData.errorCode || orderData.errorMessage) {
        throw new Error(`Ultra API Application Error: ${orderData.errorMessage}`);
    }

    const { transaction: base64Tx, requestId, outAmount } = orderData;

    if (!base64Tx) {
        throw new Error(`Ultra returned no transaction: ${JSON.stringify(orderData)}`);
    }

    // 2. Sign the transaction
    const txBuf = Buffer.from(base64Tx, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuf);
    transaction.sign([wallet]);
    const signedTx = Buffer.from(transaction.serialize()).toString('base64');

    // 3. POST /execute → signature
    const execRes = await fetch(`${JUPITER_ULTRA_API}/execute`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransaction: signedTx, requestId }),
    });

    if (!execRes.ok) {
        const body = await execRes.text();
        throw new Error(`Ultra /execute failed (${execRes.status}): ${body}`);
    }

    const execData = await execRes.json() as any;

    if (execData.status === 'Failed') {
        throw new Error(`Swap execution failed on-chain: code=${execData.code}`);
    }

    const txSignature = execData.signature as string;

    // Confirm on-chain (Ultra technically submits it immediately, but verify anyway)
    await connection.confirmTransaction(txSignature, 'confirmed');

    logger.info({ txSignature, inputMint, outputMint, amount }, 'Jupiter Ultra swap executed');

    return {
        txSignature,
        inputMint,
        outputMint,
        inAmount: Number(execData.inputAmountResult ?? amount),
        outAmount: Number(execData.outputAmountResult ?? outAmount ?? 0),
    };
}

// ─── Fallback path: Jupiter Quote V6 + Swap ─────────────────────────

async function quoteSwap(
    connection: Connection,
    wallet: Keypair,
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
): Promise<SwapResult> {
    // 1. Fetch exact token decimals to prevent math scaling exceptions
    let decimals = 9;
    if (inputMint !== SOL_MINT) {
        try {
            const mintInfo = await connection.getParsedAccountInfo(new PublicKey(inputMint));
            decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 9;
        } catch { }
    }
    const amountStr = Math.floor(amount * Math.pow(10, decimals)).toString();

    // 1. GET /quote
    const quoteParams = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amountStr,
        slippageBps: String(slippageBps),
    });

    const quoteRes = await fetch(`${QUOTE_API}/quote?${quoteParams}`);
    if (!quoteRes.ok) {
        const body = await quoteRes.text();
        throw new Error(`Quote failed (${quoteRes.status}): ${body}`);
    }

    const quoteData = await quoteRes.json() as any;

    // 2. POST /swap
    const swapRes = await fetch(`${QUOTE_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto',
        }),
    });

    if (!swapRes.ok) {
        const body = await swapRes.text();
        throw new Error(`Swap failed (${swapRes.status}): ${body}`);
    }

    const { swapTransaction } = await swapRes.json() as { swapTransaction: string };

    // 3. Deserialize, sign, send
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuf);
    transaction.sign([wallet]);

    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
    });

    await connection.confirmTransaction(txSignature, 'confirmed');

    logger.info({ txSignature, inputMint, outputMint, amount }, 'Quote V6 swap executed');

    return {
        txSignature,
        inputMint,
        outputMint,
        inAmount: Number(quoteData.inAmount ?? amount),
        outAmount: Number(quoteData.outAmount ?? 0),
    };
}

// ─── Public API ────────────────────────────────────────────────────

export async function executeSwap(
    connection: Connection,
    wallet: Keypair,
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
): Promise<SwapResult> {
    const normalizedInput = normalizeMint(inputMint);
    const normalizedOutput = normalizeMint(outputMint);

    // Try Jupiter Ultra V1 first (requires JUPITER_API_KEY), fallback to Quote V6
    if (getApiKey()) {
        try {
            return await swapUltra(connection, wallet, normalizedInput, normalizedOutput, amount, slippageBps);
        } catch (ultraError) {
            logger.warn({ error: String(ultraError) }, 'Ultra V1 failed, falling back to Quote V6 API');
        }
    } else {
        logger.warn('JUPITER_API_KEY not set, using Quote V6 API');
    }

    return await quoteSwap(connection, wallet, normalizedInput, normalizedOutput, amount, slippageBps);
}
