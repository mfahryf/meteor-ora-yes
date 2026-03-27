// src/chain/dlmm.test.ts
import { expect, test } from "bun:test";
import { getDlmmPool } from "./dlmm";
import { getJupiterQuote } from "./jupiter";
import { PublicKey } from "@solana/web3.js";

test("exports dlmm pool getter", () => {
    expect(typeof getDlmmPool).toBe("function");
});

test("exports jupiter tool", () => {
    expect(typeof getJupiterQuote).toBe("function");
});
