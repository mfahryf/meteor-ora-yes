# Phase 5: Brain / LLM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide the LLM Client, the specific prompt templates mapping to the distinct roles (SCREENER, MANAGER, EVOLVER, CHAT), and action parsing.

**Architecture:** Use `openai` sdk utilizing config variables. Construct dynamic prompts based on agent role that inject the live context exactly as designed.

**Tech Stack:** Bun, TypeScript, `openai`

---

### Task 1: LLM Client and Decision Parser

**Files:**
- Create: `src/brain/llm.ts`
- Create: `src/brain/decision.ts`
- Create: `src/brain/llm.test.ts`

**Step 1: Write the failing test**

```typescript
// src/brain/llm.test.ts
import { expect, test } from "bun:test";
import { getLLMClient } from "./llm";
import { parseDecision } from "./decision";

test("instantiates an openai compatible client", () => {
    const client = getLLMClient("https://api.openai.com/v1", "key");
    expect(client.baseURL).toBe("https://api.openai.com/v1/");
});

test("parses tool calls from LLM response safely", () => {
   const mockLlmResponse = {
       content: "Thinking...",
       tool_calls: [{ function: { name: "deploy_position", arguments: "{}" } }]
   };
   const actions = parseDecision(mockLlmResponse as any);
   expect(actions[0].name).toBe("deploy_position");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/brain/llm.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/brain/llm.ts
import OpenAI from "openai";

let client: OpenAI | null = null;

export function getLLMClient(baseUrl: string, apiKey: string): OpenAI {
    if (!client) {
        client = new OpenAI({ baseURL: baseUrl, apiKey: apiKey });
    }
    return client;
}
```

```typescript
// src/brain/decision.ts
export function parseDecision(responseMessage: any): any[] {
    if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        return [];
    }
    return responseMessage.tool_calls.map((call: any) => ({
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments || "{}"),
        id: call.id
    }));
}
```

**Step 4: Run test to verify it passes**

Run: `bun install openai`
Run: `bun test src/brain/llm.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/brain/llm.ts src/brain/decision.ts src/brain/llm.test.ts package.json bun.lockb
git commit -m "feat: initialize LLM client and decision parser"
```

---

### Task 2: Role-Based System Prompts

**Files:**
- Create: `src/brain/prompt.ts`
- Create: `src/brain/prompts/chat.ts`

**Step 1: Write the failing test**

```typescript
// src/brain/prompt.test.ts
import { expect, test } from "bun:test";
import { buildSystemPrompt } from "./prompt";

test("buildSystemPrompt loads specific roles", () => {
    const chatPrompt = buildSystemPrompt("CHAT", { balance: 1.5 });
    expect(chatPrompt).toContain("CHAT agent");
    expect(chatPrompt).toContain("1.5");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/brain/prompt.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/brain/prompts/chat.ts
export const CHAT_PROMPT = `You are the CHAT agent for the DLMM liquidity system.
You answer user queries using natural language and can execute commands.
Current State:
{STATE_JSON}`;
```

```typescript
// src/brain/prompt.ts
import { CHAT_PROMPT } from "./prompts/chat";

export function buildSystemPrompt(role: string, stateContext: any): string {
    let base = `You are the ${role} agent.\n`;
    const stateJson = JSON.stringify(stateContext, null, 2);

    if (role === "CHAT") {
        return CHAT_PROMPT.replace("{STATE_JSON}", stateJson);
    }
    // Add other roles mapping here
    return base + `\nState:\n${stateJson}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/brain/prompt.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/brain/prompt.ts src/brain/prompts/chat.ts src/brain/prompt.test.ts
git commit -m "feat: add role-based system prompts including chat"
```
