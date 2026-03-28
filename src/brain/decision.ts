// src/brain/decision.ts
// Parse LLM response to extract tool calls or final answer

import { logger } from "../utils/logger";

export interface ParsedAction {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface ParsedDecision {
    hasToolCalls: boolean;
    actions: ParsedAction[];
    finalAnswer: string | null;
}

export function parseDecision(responseMessage: any): ParsedDecision {
    const toolCalls = responseMessage?.tool_calls || [];

    // Support legacy function_call format which some OpenAI-compatible APIs (like GLM) still use
    if (responseMessage?.function_call && toolCalls.length === 0) {
        toolCalls.push({
            id: "call_" + Math.random().toString(36).substring(2, 9),
            type: "function",
            function: responseMessage.function_call
        });
        // Normalize the message so the API accepts the follow-up tool roles
        responseMessage.tool_calls = toolCalls;
        delete responseMessage.function_call;
    }

    if (!toolCalls || toolCalls.length === 0) {
        const content = responseMessage?.content || "";
        logger.debug({ content: content.slice(0, 200) }, "LLM returned final answer");
        return { hasToolCalls: false, actions: [], finalAnswer: content };
    }

    const actions: ParsedAction[] = toolCalls.map((call: any) => {
        let args: Record<string, any> = {};
        try {
            args = JSON.parse(call.function.arguments || "{}");
        } catch {
            logger.warn({ toolCallId: call.id }, "Failed to parse tool call arguments");
        }

        return {
            id: call.id,
            name: call.function.name,
            arguments: args,
        };
    });

    logger.debug({ actions: actions.map(a => a.name) }, "LLM requested tool calls");
    return { hasToolCalls: true, actions, finalAnswer: null };
}
