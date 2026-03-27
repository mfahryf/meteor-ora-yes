// src/chain/jupiter.ts
import { createJupiterApiClient, QuoteGetRequest, QuoteResponse } from '@jup-ag/api';

const jupiterApi = createJupiterApiClient({ basePath: 'https://quote-api.jup.ag/v6' });

export async function getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
): Promise<QuoteResponse> {
    const params: QuoteGetRequest = { inputMint, outputMint, amount, slippageBps };
    return await jupiterApi.quoteGet(params);
}
