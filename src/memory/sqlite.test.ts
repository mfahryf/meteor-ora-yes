// src/memory/sqlite.test.ts
import { expect, test, afterAll } from "bun:test";
import { initDb, db } from "./sqlite";

test("initializes database tables", () => {
  initDb(":memory:"); // Use in-memory DB for tests

  const tradesQuery = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='trades'");
  const result = tradesQuery.get() as any;

  expect(result.name).toBe("trades");
});

afterAll(() => {
  db.close();
});
