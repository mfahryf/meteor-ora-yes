// src/core/lifecycle.ts
import { logger } from "../utils/logger";
import { scheduleJob, stopAllJobs, pauseAllJobs, resumeAllJobs, isPaused, listJobs } from "./scheduler";
import { agentLoop } from "./agent";
import { startBot, stopBot } from "../telegram/bot";
import { initDb, closeDb } from "../memory/sqlite";
import { loadConfig } from "../config/loader";
import { getConnection, getSolBalance, getTokenBalances } from "../chain/connection";
import { getWallet } from "../chain/wallet";
import { ensureCollections } from "../memory/lessons";
import { registerAllTools } from "../tools/register";
import type { Config } from "../config/schema";
import type { Role } from "../brain/prompt";

let config: Config;
let shuttingDown = false;

export function getConfig(): Config {
    return config;
}

export function pauseAgent(): void {
    pauseAllJobs();
}

export function resumeAgent(): void {
    resumeAllJobs();
}

export function agentIsPaused(): boolean {
    return isPaused();
}

export async function boot(configPath?: string): Promise<void> {
    logger.info("DLMM Agent booting...");

    // 1. Load and validate config
    config = loadConfig(configPath);

    // 2. Initialize SQLite
    initDb("data/dlmm.db");
    logger.info("SQLite initialized");

    // 3. Initialize Qdrant collections
    try {
        await ensureCollections();
        logger.info("Qdrant collections ensured");
    } catch (error) {
        logger.warn({ error }, "Qdrant not available, continuing without vector memory");
    }

    // 4. Initialize chain connections
    const rpcUrl = `${config.credentials.rpcUrl}`;
    const connection = getConnection(rpcUrl);
    const wallet = getWallet();
    const walletPubkey = wallet.publicKey.toBase58();
    logger.info({ wallet: walletPubkey }, "Wallet loaded");

    // 5. Register tools
    registerAllTools(config, connection, wallet);
    logger.info("Tools registered");

    // 6. Start Telegram bot
    if (config.credentials.telegramBotToken) {
        try {
            await startBot(config);
            logger.info("Telegram bot started");
        } catch (error) {
            logger.warn({ error }, "Telegram bot failed to start, continuing without");
        }
    }

    // 7. Schedule agent cycles
    const managementIntervalMs = config.schedule.managementIntervalMin * 60 * 1000;
    const screeningIntervalMs = config.schedule.screeningIntervalMin * 60 * 1000;
    const evolutionIntervalMs = config.schedule.evolutionIntervalHours * 60 * 60 * 1000;
    const healthIntervalMs = config.schedule.healthCheckIntervalMin * 60 * 1000;

    // Helper to fetch fresh wallet data for agent context
    async function getWalletDeps() {
        try {
            const solBalance = await getSolBalance(walletPubkey);
            const tokenBalances = await getTokenBalances(walletPubkey);
            return { walletSolBalance: solBalance, walletTokenBalances: tokenBalances };
        } catch (error) {
            logger.warn({ error }, "Failed to fetch wallet balance, using 0");
            return { walletSolBalance: 0, walletTokenBalances: {} as Record<string, number> };
        }
    }

    scheduleJob("MANAGER", managementIntervalMs, async () => {
        const deps = await getWalletDeps();
        await agentLoop("Monitor open positions, rebalance or close as needed", "MANAGER" as Role, config, deps);
    });

    scheduleJob("SCREENER", screeningIntervalMs, async () => {
        const deps = await getWalletDeps();
        await agentLoop("Find trending pools and deploy liquidity", "SCREENER" as Role, config, deps);
    });

    scheduleJob("EVOLVER", evolutionIntervalMs, async () => {
        const deps = await getWalletDeps();
        await agentLoop("Analyze performance and propose strategy improvements", "EVOLVER" as Role, config, deps);
    });

    scheduleJob("HEALTH", healthIntervalMs, async () => {
        try {
            const solBalance = await getSolBalance(walletPubkey);
            logger.info({ solBalance, jobs: listJobs().length, paused: isPaused() }, "Health check OK");
        } catch (error) {
            logger.warn({ error }, "Health check failed to fetch balance");
        }
    });

    logger.info({
        managementIntervalMin: config.schedule.managementIntervalMin,
        screeningIntervalMin: config.schedule.screeningIntervalMin,
        evolutionIntervalHours: config.schedule.evolutionIntervalHours,
    }, "DLMM Agent running");

    // Keep process alive
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
}

async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Graceful shutdown initiated...");
    stopAllJobs();
    stopBot();
    closeDb();
    logger.info("DLMM Agent shut down cleanly");
    process.exit(0);
}
