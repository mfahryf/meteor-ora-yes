// src/chain/dlmm.test.ts
import { expect, test } from "bun:test";
import { getDlmmPool, getActiveBin } from "./dlmm";
import { Connection } from "@solana/web3.js";

test("getDlmmPool rejects invalid pool address", async () => {
    const conn = new Connection("https://api.mainnet-beta.solana.com");
    await expect(getDlmmPool(conn, "invalid")).rejects.toThrow("Failed to load DLMM pool");
});

test("getActiveBin rejects invalid pool address", async () => {
    const conn = new Connection("https://api.mainnet-beta.solana.com");
    await expect(getActiveBin(conn, "invalid")).rejects.toThrow();
});
