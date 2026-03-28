// src/chain/chain.test.ts
import { expect, test, afterEach } from "bun:test";
import { getConnection, resetConnection } from "./connection";
import { getWallet, resetWallet } from "./wallet";
import { Keypair } from "@solana/web3.js";

afterEach(() => {
    resetConnection();
    resetWallet();
});

test("creates connection with confirmed commitment", () => {
    const conn = getConnection("https://api.mainnet-beta.solana.com");
    expect(conn.rpcEndpoint).toBe("https://api.mainnet-beta.solana.com");
});

test("returns same connection on second call", () => {
    const conn1 = getConnection("https://api.mainnet-beta.solana.com");
    const conn2 = getConnection("https://api.mainnet-beta.solana.com");
    expect(conn1).toBe(conn2);
});

test("resetConnection allows new connection", () => {
    const conn1 = getConnection("https://api.mainnet-beta.solana.com");
    resetConnection();
    const conn2 = getConnection("https://api.mainnet-beta.solana.com");
    expect(conn1).not.toBe(conn2);
});

test("loads wallet from JSON env var", () => {
    const keypair = Keypair.generate();
    process.env.SOLANA_PRIVATE_KEY = JSON.stringify(Array.from(keypair.secretKey));
    const wallet = getWallet();
    expect(wallet.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
});

test("throws when SOLANA_PRIVATE_KEY is not set", () => {
    delete process.env.SOLANA_PRIVATE_KEY;
    expect(() => getWallet()).toThrow("SOLANA_PRIVATE_KEY is not set");
});
