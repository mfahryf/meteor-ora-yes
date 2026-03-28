// src/telegram/chat.ts
import { loadSession, saveSession } from "./session";
import { agentLoop } from "../brain/agent";
import { logger } from "../utils/logger";
import type { Config } from "../config/schema";
import type { Role } from "../brain/prompt";

export async function handleChatMessage(
    chatId: string,
    text: string,
    config: Config,
    walletSolBalance: number = 0,
    walletTokenBalances: Record<string, number> = {}
): Promise<string> {
    try {
        // Load existing session
        const session = loadSession(chatId);

        // Add user message to history
        session.messageHistory.push({ role: "user", content: text });

        // Keep only last N messages to stay within context window
        const historyLimit = config.telegram.chatHistoryLimit || 20;
        const truncatedHistory = session.messageHistory.slice(-historyLimit);

        // Run agent loop in CHAT role
        const result = await agentLoop(
            text,
            "CHAT" as Role,
            config,
            {
                walletSolBalance,
                walletTokenBalances,
            },
            config.llm.maxSteps,
            truncatedHistory.slice(0, -1) // exclude current message (it's already the goal)
        );

        // Save updated session
        session.messageHistory.push({ role: "assistant", content: result.content });
        saveSession(chatId, session.messageHistory, session.context);

        return result.content;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ chatId, error: msg }, "Chat handler failed");
        return `Error: ${msg}`;
    }
}

export async function handleBotMessage(
    chatId: string,
    text: string,
    config: Config,
    walletSolBalance: number = 0,
    walletTokenBalances: Record<string, number> = {}
): Promise<string> {
    // Non-command messages go through natural language chat
    return handleChatMessage(chatId, text, config, walletSolBalance, walletTokenBalances);
}
