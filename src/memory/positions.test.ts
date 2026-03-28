// src/memory/positions.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb, getDb } from "./sqlite";
import { insertPosition, getOpenPositions } from "./positions";

beforeAll(() => {
    initDb(":memory:");
});

afterAll(() => {
    closeDb();
});

test("can insert and retrieve an open position", () => {
    insertPosition({
        position_pubkey: "mock_pubkey_1",
        pool_address: "mock_pool",
        strategy_type: "spot",
        bin_step: 100,
        min_bin: -10,
        max_bin: 10,
        amount_x: 0.1,
        amount_y: 50.0,
        status: "open"
    });

    const open = getOpenPositions();
    expect(open.length).toBe(1);
    expect(open[0].position_pubkey).toBe("mock_pubkey_1");
    expect(open[0].status).toBe("open");
});

test("does not return closed positions", () => {
    const db = getDb();
    db.exec(`UPDATE positions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE position_pubkey = 'mock_pubkey_1'`);

    const open = getOpenPositions();
    expect(open.length).toBe(0);
});
