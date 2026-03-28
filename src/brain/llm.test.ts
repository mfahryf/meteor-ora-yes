// src/brain/llm.test.ts
import { expect, test } from "bun:test";
import { getLLMClient, resetLLMClient } from "./llm";
import { parseDecision } from "./decision";

test("instantiates an OpenAI-compatible client", () => {
    resetLLMClient();
    const client = getLLMClient("https://api.z.ai/api/coding/paas/v4", "test-key");
    expect(client.baseURL).toContain("api.z.ai");
});

test("parses tool calls from LLM response", () => {
    const mockResponse = {
        content: "Thinking...",
        tool_calls: [
            { id: "call_1", function: { name: "deploy_position", arguments: '{"pool_address":"abc","amount_sol":0.1}' } },
            { id: "call_2", function: { name: "get_wallet_balance", arguments: "{}" } },
        ],
    };

    const decision = parseDecision(mockResponse as any);
    expect(decision.hasToolCalls).toBe(true);
    expect(decision.actions.length).toBe(2);
    expect(decision.actions[0].name).toBe("deploy_position");
    expect(decision.actions[0].arguments.pool_address).toBe("abc");
    expect(decision.actions[1].name).toBe("get_wallet_balance");
    expect(decision.finalAnswer).toBeNull();
});

test("returns final answer when no tool calls", () => {
    const mockResponse = {
        content: "I've analyzed the pools and found 3 good candidates.",
        tool_calls: undefined,
    };

    const decision = parseDecision(mockResponse as any);
    expect(decision.hasToolCalls).toBe(false);
    expect(decision.actions.length).toBe(0);
    expect(decision.finalAnswer).toContain("3 good candidates");
});

test("handles malformed tool call arguments gracefully", () => {
    const mockResponse = {
        content: null,
        tool_calls: [
            { id: "call_bad", function: { name: "test", arguments: "not-json" } },
        ],
    };

    const decision = parseDecision(mockResponse as any);
    expect(decision.hasToolCalls).toBe(true);
    expect(decision.actions[0].arguments).toEqual({});
});

test("handles empty tool calls array", () => {
    const decision = parseDecision({ content: "done", tool_calls: [] });
    expect(decision.hasToolCalls).toBe(false);
    expect(decision.finalAnswer).toBe("done");
});
