// src/memory/sqlite.test.ts
import { expect, test, afterAll } from "bun:test";
import { initDb, getDb, closeDb } from "./sqlite";

test("initializes database and creates all tables", () => {
  initDb(":memory:");
  const db = getDb();

  const tables = ["trades", "positions", "fee_claims", "config_log", "agent_runs", "chat_sessions"];
  for (const table of tables) {
    const row = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).get() as any;
    expect(row?.name).toBe(table);
  }
});

test("throws if getDb called before initDb", () => {
  closeDb();
  expect(() => getDb()).toThrow("Database not initialized");
});

test("chat_sessions index exists", () => {
  initDb(":memory:");
  const db = getDb();
  const row = db.query(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chat_sessions_last_activity'`).get() as any;
  expect(row?.name).toBe("idx_chat_sessions_last_activity");
});

afterAll(() => {
  closeDb();
});
