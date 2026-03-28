// src/memory/pool-notes.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "./sqlite";
import { addPoolNote, getPoolNotes } from "./pool-notes";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("addPoolNote adds note", () => {
    addPoolNote("PoolABC", "Good pool, high volume", "SCREENER");
    const notes = getPoolNotes("PoolABC");
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe("Good pool, high volume");
    expect(notes[0].agentType).toBe("SCREENER");
});

test("getPoolNotes returns empty for unknown pool", () => {
    const notes = getPoolNotes("UnknownPool");
    expect(notes.length).toBe(0);
});

test("getPoolNotes respects limit", () => {
    for (let i = 0; i < 5; i++) {
        addPoolNote("PoolDEF", `Note ${i}`, "MANAGER");
    }
    const notes = getPoolNotes("PoolDEF", 3);
    expect(notes.length).toBe(3);
});

test("getPoolNotes returns notes for pool", () => {
    const notes = getPoolNotes("PoolDEF", 3);
    expect(notes.length).toBe(3);
    expect(notes.every(n => n.poolAddress === "PoolDEF")).toBe(true);
});
