# Phase 7: Telegram Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create an interactive Telegram Bot that routes incoming chat to specific functions, implements session memory for the `CHAT` role, and intercepts slash commands.

**Architecture:** Use `grammy` to instantiate the bot structure. Separates logic into `bot.ts` (routing), `commands.ts` (static actions), `session.ts` (SQLite state for conversations), and `chat.ts` (natural language LLM handoff).

**Tech Stack:** Bun, TypeScript, `grammy`

---

### Task 1: Chat Session Management

**Files:**
- Create: `src/telegram/session.ts`
- Create: `src/telegram/session.test.ts`

**Step 1: Write the failing test**

```typescript
// src/telegram/session.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { initDb, db } from "../memory/sqlite";
import { saveSession, loadSession } from "./session";

beforeAll(() => initDb(":memory:"));
afterAll(() => db.close());

test("loads and saves chat session state", () => {
    const chatId = "12345";
    saveSession(chatId, [{ role: "user", content: "Hi" }]);
    const sess = loadSession(chatId);
    expect(sess.messageHistory.length).toBe(1);
    expect(sess.messageHistory[0].content).toBe("Hi");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/telegram/session.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/telegram/session.ts
import { db } from "../memory/sqlite";

export interface ChatSession {
    sessionId: string;
    messageHistory: any[];
    context: any;
}

export function saveSession(chatId: string, messages: any[], context: any = {}) {
    const stmt = db.prepare(`
        INSERT INTO chat_sessions (session_id, message_history, context, last_activity)
        VALUES ($id, $hist, $ctx, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id) DO UPDATE SET
        message_history=excluded.message_history, context=excluded.context, last_activity=CURRENT_TIMESTAMP
    `);
    stmt.run({ $id: chatId, $hist: JSON.stringify(messages), $ctx: JSON.stringify(context) });
}

export function loadSession(chatId: string): ChatSession {
    const stmt = db.prepare(`SELECT * FROM chat_sessions WHERE session_id = ?`);
    const row = stmt.get(chatId) as any;
    if (!row) return { sessionId: chatId, messageHistory: [], context: {} };
    return {
        sessionId: row.session_id,
        messageHistory: JSON.parse(row.message_history),
        context: JSON.parse(row.context)
    };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/telegram/session.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/telegram/session.ts src/telegram/session.test.ts
git commit -m "feat: implement Telegram chat session manager"
```

---

### Task 2: Bot Initialization & Natural Language Router

**Files:**
- Create: `src/telegram/bot.ts`
- Create: `src/telegram/chat.ts`

**Step 1: Write the failing test**

```typescript
// src/telegram/bot.test.ts
import { expect, test } from "bun:test";
import { setupBot } from "./bot";
import { handleNaturalLanguage } from "./chat";

test("initializes grammy bot instance", () => {
    const bot = setupBot("mock:token", []);
    expect(bot).toBeDefined();
});

test("exports chat handler", () => {
    expect(typeof handleNaturalLanguage).toBe("function");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/telegram/bot.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/telegram/chat.ts
import { loadSession, saveSession } from "./session";

export async function handleNaturalLanguage(chatId: string, text: string): Promise<string> {
    const session = loadSession(chatId);
    session.messageHistory.push({ role: "user", content: text });
    // Agent Loop call would go here. For now, echo.
    const response = `Agent received: ${text}`;
    session.messageHistory.push({ role: "assistant", content: response });
    saveSession(chatId, session.messageHistory, session.context);
    return response;
}
```

```typescript
// src/telegram/bot.ts
import { Bot, Context } from "grammy";
import { handleNaturalLanguage } from "./chat";

let botInstance: Bot<Context> | null = null;

export function setupBot(token: string, authorizedUsers: string[]): Bot<Context> {
    if (!botInstance) {
        botInstance = new Bot(token);

        // Security middleware
        botInstance.use(async (ctx, next) => {
            const chatId = ctx.chat?.id?.toString();
            if (!chatId || !authorizedUsers.includes(chatId)) return;
            await next();
        });

        // Slash command route
        botInstance.command("start", (ctx) => ctx.reply("DLMM Agent Started."));

        // Conversational generic route
        botInstance.on("message:text", async (ctx) => {
            const chatId = ctx.chat.id.toString();
            const response = await handleNaturalLanguage(chatId, ctx.message.text);
            await ctx.reply(response);
        });
    }
    return botInstance;
}
```

**Step 4: Run test to verify it passes**

Run: `bun install grammy`
Run: `bun test src/telegram/bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/telegram/bot.ts src/telegram/chat.ts src/telegram/bot.test.ts package.json bun.lockb
git commit -m "feat: setup grammar telegram bot and chat routing"
```