// src/chain/wallet.ts
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

let wallet: Keypair | null = null;

export function getWallet(): Keypair {
    if (!wallet) {
        const privateKey = process.env.SOLANA_PRIVATE_KEY;
        if (!privateKey) throw new Error("SOLANA_PRIVATE_KEY is not set");

        try {
            wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
        } catch {
            const secretKeyArray = Uint8Array.from(JSON.parse(privateKey));
            wallet = Keypair.fromSecretKey(secretKeyArray);
        }
    }
    return wallet;
}

export function resetWallet(): void {
    wallet = null;
}
