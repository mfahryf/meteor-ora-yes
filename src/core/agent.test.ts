// src/core/agent.test.ts
import { expect, test, beforeAll, afterAll } from "bun:test";
import { agentLoop, type AgentDependencies } from "./agent";
import { registerTool, resetRegistry } from "../tools/registry";
import { initDb, closeDb } from "../memory/sqlite";
import { resetLLMClient } from "../brain/llm";
import type { Config } from "../config/schema";
import { defaultConfig } from "../config/defaults";

const mockConfig: Config = {
    ...defaultConfig,
    llm: {
        ...defaultConfig.llm,
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        apiKey: "test-key",
        maxSteps: 3,
        temperature: 0,
        maxTokens: 500,
    },
    runtime: { ...defaultConfig.runtime, dryRun: true },
};

beforeAll(() => {
    initDb(":memory:");
});

afterAll(() => {
    closeDb();
    resetLLMClient();
});

test("agentLoop returns error when LLM call fails", async () => {
    resetRegistry();
    registerTool("get_wallet_balance", async () => ({ sol: 1.0 }));

    const deps: AgentDependencies = {
        walletSolBalance: 1.0,
        walletTokenBalances: {},
    };

    const result = await agentLoop("What is my balance?", "CHAT", mockConfig, deps);
    expect(result.success).toBe(false);
    expect(result.content).toContain("error");
});

test("agentLoop handles max steps gracefully", async () => {
    resetRegistry();

    const config = { ...mockConfig, llm: { ...mockConfig.llm, maxSteps: 1 } };
    const deps: AgentDependencies = {
        walletSolBalance: 1.0,
        walletTokenBalances: {},
    };

    const result = await agentLoop("test goal", "CHAT", config, deps);
    expect(result).toBeDefined();
    expect(result.userMessage).toBe("test goal");
    expect(typeof result.success).toBe("boolean");
});
