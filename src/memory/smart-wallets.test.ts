// src/memory/smart-wallets.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "./sqlite";
import { addSmartWallet, removeSmartWallet, listSmartWallets, isSmartWallet } from "./smart-wallets";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("addSmartWallet adds entry", () => {
    addSmartWallet("Wallet111", "whale");
    const wallets = listSmartWallets();
    expect(wallets.length).toBe(1);
    expect(wallets[0].address).toBe("Wallet111");
    expect(wallets[0].label).toBe("whale");
});

test("isSmartWallet returns true for tracked", () => {
    expect(isSmartWallet("Wallet111")).toBe(true);
});

test("isSmartWallet returns false for unknown", () => {
    expect(isSmartWallet("UnknownWallet")).toBe(false);
});

test("addSmartWallet upserts on conflict", () => {
    addSmartWallet("Wallet111", "updated label");
    const wallets = listSmartWallets();
    expect(wallets.length).toBe(1);
    expect(wallets[0].label).toBe("updated label");
});

test("removeSmartWallet removes entry", () => {
    const removed = removeSmartWallet("Wallet111");
    expect(removed).toBe(true);
    expect(isSmartWallet("Wallet111")).toBe(false);
});

test("removeSmartWallet returns false for missing", () => {
    expect(removeSmartWallet("NonExistent")).toBe(false);
});
