// src/telegram/commands.ts
import { logger } from "../utils/logger";
import { dispatchCommand, type CommandContext } from "../core/commands";
import type { Config } from "../config/schema";
import { sendMessage } from "./bot";

export async function handleTelegramCommand(chatId: string, text: string, config: Config): Promise<void> {
    const commands = ["start", "status", "positions", "pnl", "pause", "resume", "clear", "lessons", "help"];
    
    const parts = text.split(/\s+/);
    // Remove the leading slash
    let cmdName = parts[0].slice(1).toLowerCase();
    
    // In Telegram, commands can be like /start@BotUsername
    cmdName = cmdName.split("@")[0];

    if (!commands.includes(cmdName)) {
        return; // Ignore unknown commands
    }

    const ctx: CommandContext = {
        config,
        walletSolBalance: 0,
        walletTokenBalances: {},
        sessionId: chatId,
    };

    try {
        const result = await dispatchCommand(cmdName, ctx);
        await sendMessage(chatId, result.text, ""); // Use raw text for command output to avoid formatting issues
    } catch (error) {
        logger.error({ error, command: cmdName }, "Failed to handle Telegram command");
        await sendMessage(chatId, "Error processing command.");
    }
}
