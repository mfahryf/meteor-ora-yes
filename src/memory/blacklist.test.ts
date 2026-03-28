// src/memory/blacklist.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "./sqlite";
import { addToBlacklist, removeFromBlacklist, listBlacklist, isBlacklisted } from "./blacklist";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("addToBlacklist adds entry", () => {
    addToBlacklist("TokenMintAAA", "rug pull");
    const list = listBlacklist();
    expect(list.length).toBe(1);
    expect(list[0].tokenMint).toBe("TokenMintAAA");
    expect(list[0].reason).toBe("rug pull");
});

test("isBlacklisted returns true for blacklisted", () => {
    expect(isBlacklisted("TokenMintAAA")).toBe(true);
});

test("isBlacklisted returns false for clean token", () => {
    expect(isBlacklisted("CleanTokenBBB")).toBe(false);
});

test("addToBlacklist upserts on conflict", () => {
    addToBlacklist("TokenMintAAA", "updated reason");
    const list = listBlacklist();
    expect(list.length).toBe(1);
    expect(list[0].reason).toBe("updated reason");
});

test("removeFromBlacklist removes entry", () => {
    const removed = removeFromBlacklist("TokenMintAAA");
    expect(removed).toBe(true);
    expect(isBlacklisted("TokenMintAAA")).toBe(false);
});

test("removeFromBlacklist returns false for missing", () => {
    expect(removeFromBlacklist("NonExistent")).toBe(false);
});
