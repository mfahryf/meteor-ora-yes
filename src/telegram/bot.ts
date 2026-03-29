// src/telegram/bot.ts
import { logger } from "../utils/logger";
import { handleTelegramCommand } from "./commands";
import { handleBotMessage } from "./chat";
import { getSolBalance, getTokenBalances } from "../chain/connection";
import { getWallet } from "../chain/wallet";
import type { Config } from "../config/schema";

let isPolling = false;
let autoRegisteredChatId: string | null = null;
let currentConfig: Config | null = null;
let botToken = "";

export async function sendMessage(chatId: string, text: string, parseMode = "Markdown"): Promise<void> {
    if (!botToken) return;

    // Telegram text cannot be empty, default to space if empty
    if (!text || text.trim() === "") text = " ";

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload: any = {
        chat_id: chatId,
        text,
    };
    if (parseMode) {
        payload.parse_mode = parseMode;
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const result = await response.json();
            logger.error({ result }, "Failed to send Telegram message");
        }
    } catch (error) {
        logger.error({ error }, "Error sending Telegram message");
    }
}

export async function broadcastMessage(text: string, parseMode = "Markdown"): Promise<void> {
    if (!currentConfig) return;
    
    const authorizedIds = currentConfig.telegram.authorizedChatIds || [];
    const targets = new Set<string>(authorizedIds);
    if (autoRegisteredChatId) targets.add(autoRegisteredChatId);

    for (const chatId of targets) {
        await sendMessage(chatId, text, parseMode);
    }
}

async function sendChatAction(chatId: string, action = "typing"): Promise<void> {
    if (!botToken) return;
    const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, action }),
        });
    } catch (error) {
        // Ignored
    }
}

export async function startBot(config: Config): Promise<void> {
    if (isPolling) return;

    botToken = config.credentials.telegramBotToken || "";
    if (!botToken) {
        throw new Error("TELEGRAM_BOT_TOKEN not required, but cannot start without it.");
    }

    currentConfig = config;
    isPolling = true;
    
    // Check if we have pre-configured authorized IDs
    const authorizedIds = config.telegram.authorizedChatIds || [];
    if (authorizedIds.length === 0) {
        logger.warn("No authorized Chat IDs configured in telegram.authorizedChatIds.");
        logger.warn("The bot will auto-register the FIRST sender as the owner.");
    } else {
        logger.info(`Telegram bot authorized for ${authorizedIds.length} user(s).`);
    }

    logger.info("Telegram bot started polling");

    // Don't await the loop, let it run in the background
    pollUpdates();
}

export function stopBot(): void {
    if (isPolling) {
        isPolling = false;
        botToken = "";
        logger.info("Telegram bot stopped");
    }
}

async function pollUpdates() {
    let offset = 0;

    while (isPolling) {
        if (!botToken) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        try {
            const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=30`;
            const response = await fetch(url);
            if (!response.ok) {
                await new Promise(r => setTimeout(r, 2000)); // slow down on error
                continue;
            }

            const data = await response.json();
            if (data.ok && data.result) {
                for (const update of data.result) {
                    offset = update.update_id + 1; // Mark as read

                    if (update.message && update.message.text) {
                        const chatId = update.message.chat.id.toString();
                        const text = update.message.text;

                        // Authorization logic
                        const authorizedIds = currentConfig?.telegram.authorizedChatIds || [];
                        let isAuthorized = false;

                        if (authorizedIds.includes(chatId)) {
                            isAuthorized = true;
                        } else if (authorizedIds.length === 0) {
                            if (!autoRegisteredChatId) {
                                // Auto-register first sender
                                autoRegisteredChatId = chatId;
                                isAuthorized = true;
                                logger.info({ chatId }, "Auto-registered first sender as bot owner");
                                await sendMessage(chatId, "✅ You have been auto-registered as the bot owner.\n\nPlease add this Chat ID to your config to persist this: `" + chatId + "`", "");
                            } else if (autoRegisteredChatId === chatId) {
                                isAuthorized = true;
                            }
                        }

                        if (!isAuthorized) {
                            logger.warn({ chatId }, "Unauthorized Telegram message attempted");
                            continue;
                        }

                        // Process authorized message
                        processMessage(chatId, text).catch(e => {
                            logger.error({ error: e }, "Error processing Telegram message");
                        });
                    }
                }
            }
        } catch (error) {
            logger.error({ error }, "Error fetching Telegram updates");
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function processMessage(chatId: string, text: string) {
    if (!currentConfig) return;

    if (text.startsWith("/")) {
        await handleTelegramCommand(chatId, text, currentConfig);
        return;
    }

    try {
        await sendChatAction(chatId, "typing");
        
        let walletSolBalance = 0;
        let walletTokenBalances: Record<string, number> = {};
        try {
            const wallet = getWallet();
            walletSolBalance = await getSolBalance(wallet.publicKey);
            walletTokenBalances = await getTokenBalances(wallet.publicKey);
        } catch {
            logger.warn("Could not fetch wallet balance for Telegram message");
        }

        const response = await handleBotMessage(chatId, text, currentConfig, walletSolBalance, walletTokenBalances);
        
        if (!response || response.trim() === "") {
            await sendMessage(chatId, "No response generated.", "");
        } else {
            await sendMessage(chatId, response);
        }
    } catch (error) {
        logger.error({ error }, "Failed to handle natural language query");
        await sendMessage(chatId, "Sorry, something went wrong.", "");
    }
}
