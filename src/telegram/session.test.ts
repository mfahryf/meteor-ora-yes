// src/telegram/session.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, closeDb } from "../memory/sqlite";
import { saveSession, loadSession, clearSession } from "./session";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("saves and loads a chat session", () => {
    saveSession("12345", [{ role: "user", content: "Hi" }]);
    const sess = loadSession("12345");
    expect(sess.messageHistory.length).toBe(1);
    expect(sess.messageHistory[0].content).toBe("Hi");
});

test("returns empty session for unknown chat id", () => {
    const sess = loadSession("unknown");
    expect(sess.messageHistory.length).toBe(0);
});

test("updates existing session on save", () => {
    saveSession("chat1", [{ role: "user", content: "msg1" }]);
    saveSession("chat1", [{ role: "user", content: "msg2" }]);
    const sess = loadSession("chat1");
    expect(sess.messageHistory.length).toBe(1);
    expect(sess.messageHistory[0].content).toBe("msg2");
});

test("clearSession removes session", () => {
    saveSession("to_clear", [{ role: "user", content: "bye" }]);
    clearSession("to_clear");
    const sess = loadSession("to_clear");
    expect(sess.messageHistory.length).toBe(0);
});

test("saveSession preserves context", () => {
    saveSession("ctx_test", [{ role: "user", content: "test" }], { pendingAction: "close" });
    const sess = loadSession("ctx_test");
    expect(sess.context.pendingAction).toBe("close");
});
