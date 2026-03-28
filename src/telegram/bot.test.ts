// src/telegram/bot.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { startBot, stopBot, sendMessage } from "./bot";
import { handleBotMessage } from "./chat";
import { initDb, closeDb } from "../memory/sqlite";
import { defaultConfig } from "../config/defaults";

beforeAll(() => initDb(":memory:"));
afterAll(() => closeDb());

test("bot exports functional methods", () => {
    expect(typeof startBot).toBe("function");
    expect(typeof stopBot).toBe("function");
    expect(typeof sendMessage).toBe("function");
});

test("handleBotMessage is a function", () => {
    expect(typeof handleBotMessage).toBe("function");
});
