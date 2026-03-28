// src/tools/registry.test.ts
import { expect, test, beforeEach } from "bun:test";
import { registerTool, executeTool, listRegisteredTools, resetRegistry } from "./registry";

beforeEach(() => {
    resetRegistry();
});

test("registers and executes a tool successfully", async () => {
    registerTool("echo", async (args: any) => `Echo: ${args.message}`);
    const result = await executeTool("echo", { message: "Hello World" });
    expect(result).toBe("Echo: Hello World");
});

test("returns error on missing tool", async () => {
    const result = await executeTool("missing", {});
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("Unknown tool");
});

test("returns error when tool throws", async () => {
    registerTool("boom", async () => { throw new Error("kaboom"); });
    const result = await executeTool("boom", {});
    expect(result).toHaveProperty("error");
    expect(result.error).toBe("kaboom");
});

test("listRegisteredTools returns all registered names", () => {
    registerTool("tool_a", async () => {});
    registerTool("tool_b", async () => {});
    const tools = listRegisteredTools();
    expect(tools).toContain("tool_a");
    expect(tools).toContain("tool_b");
    expect(tools.length).toBe(2);
});

test("resetRegistry clears all tools", () => {
    registerTool("temp", async () => {});
    resetRegistry();
    expect(listRegisteredTools().length).toBe(0);
});
