// src/tools/registry.ts
import { logger } from "../utils/logger";

export type ToolFn = (args: any) => Promise<any>;

const toolMap = new Map<string, ToolFn>();

export function registerTool(name: string, fn: ToolFn): void {
    toolMap.set(name, fn);
    logger.debug({ tool: name }, "Tool registered");
}

export async function executeTool(name: string, args: any): Promise<any> {
    const fn = toolMap.get(name);
    if (!fn) {
        logger.warn({ tool: name }, "Unknown tool called");
        return { error: `Unknown tool: ${name}`, tool: name };
    }

    try {
        logger.info({ tool: name, args }, "Executing tool");
        const result = await fn(args);
        logger.info({ tool: name }, "Tool executed successfully");
        return result;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ tool: name, error: msg }, "Tool execution failed");
        return { error: msg, tool: name };
    }
}

export function listRegisteredTools(): string[] {
    return Array.from(toolMap.keys());
}

export function resetRegistry(): void {
    toolMap.clear();
}
