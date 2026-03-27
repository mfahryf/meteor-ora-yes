// src/chain/chain.test.ts
import { expect, test } from "bun:test";
import { getConnection } from "./connection";
import { getWallet } from "./wallet";
import { Keypair } from "@solana/web3.js";

test("creates a valid RPC connection", () => {
    const conn = getConnection("https://api.mainnet-beta.solana.com");
    expect(conn.rpcEndpoint).toBe("https://api.mainnet-beta.solana.com");
});

test("generates or gets Wallet from env", () => {
    process.env.SOLANA_PRIVATE_KEY = JSON.stringify(Array.from(Keypair.generate().secretKey));
    const wallet = getWallet();
    expect(wallet.publicKey).toBeDefined();
});
