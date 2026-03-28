// src/tools/definitions.test.ts
import { expect, test } from "bun:test";
import { ALL_TOOLS, getToolsForRole, getWriteTools, getToolByName } from "./definitions";

test("exports valid OpenAI tool schemas", () => {
    expect(ALL_TOOLS.length).toBeGreaterThan(0);
    for (const t of ALL_TOOLS) {
        expect(t.type).toBe("function");
        expect(t.function.name).toBeDefined();
        expect(t.function.parameters.type).toBe("object");
        expect(t.function.parameters.properties).toBeDefined();
        expect(Array.isArray(t.function.parameters.required)).toBe(true);
    }
});

test("all tools have metadata", () => {
    for (const t of ALL_TOOLS) {
        expect(t._meta).toBeDefined();
        expect(t._meta!.category).toBeDefined();
        expect(typeof t._meta!.write).toBe("boolean");
        expect(t._meta!.roles.length).toBeGreaterThan(0);
    }
});

test("has expected number of tools", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(30);
});

test("getToolsForRole filters correctly", () => {
    const screenerTools = getToolsForRole("SCREENER");
    const managerTools = getToolsForRole("MANAGER");
    const chatTools = getToolsForRole("CHAT");

    expect(screenerTools.length).toBeGreaterThan(0);
    expect(managerTools.length).toBeGreaterThan(0);
    expect(chatTools.length).toBeGreaterThan(0);

    // CHAT should have the most tools (all)
    expect(chatTools.length).toBe(ALL_TOOLS.length);

    // SCREENER should have deploy_position
    expect(screenerTools.some(t => t.function.name === "deploy_position")).toBe(true);
    // MANAGER should have claim_fees but not deploy_position
    expect(managerTools.some(t => t.function.name === "claim_fees")).toBe(true);
    expect(managerTools.some(t => t.function.name === "deploy_position")).toBe(false);
});

test("getWriteTools returns only WRITE tools", () => {
    const writeTools = getWriteTools();
    expect(writeTools.length).toBeGreaterThan(0);
    for (const t of writeTools) {
        expect(t._meta!.write).toBe(true);
    }
    // deploy_position should be a write tool
    expect(writeTools.some(t => t.function.name === "deploy_position")).toBe(true);
    // get_wallet_balance should NOT be a write tool
    expect(writeTools.some(t => t.function.name === "get_wallet_balance")).toBe(false);
});

test("getToolByName finds specific tools", () => {
    const deploy = getToolByName("deploy_position");
    expect(deploy).toBeDefined();
    expect(deploy!.function.name).toBe("deploy_position");

    const missing = getToolByName("nonexistent_tool");
    expect(missing).toBeUndefined();
});

test("specific tool definitions match design doc", () => {
    const deploy = getToolByName("deploy_position")!;
    expect(deploy.function.parameters.required).toContain("pool_address");
    expect(deploy.function.parameters.required).toContain("amount_sol");

    const swap = getToolByName("swap_token")!;
    expect(swap.function.parameters.required).toContain("input_mint");
    expect(swap.function.parameters.required).toContain("output_mint");
    expect(swap.function.parameters.required).toContain("amount");
});
