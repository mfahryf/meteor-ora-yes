// src/core/lifecycle.ts
// Ported from Meridian: dynamic management interval, race condition guards, graceful shutdown with position report
import { logger } from "../utils/logger";
import { scheduleJob, stopAllJobs, stopJob, pauseAllJobs, resumeAllJobs, isPaused, listJobs } from "./scheduler";
import { agentLoop } from "./agent";
import { startBot, stopBot, sendMessage } from "../telegram/bot";
import { initDb, closeDb } from "../memory/sqlite";
import { loadConfig } from "../config/loader";
import { getConnection, getSolBalance, getTokenBalances } from "../chain/connection";
import { getWallet } from "../chain/wallet";
import { ensureCollections } from "../memory/lessons";
import { registerAllTools } from "../tools/register";
import { getOpenPositions } from "../memory/positions";
import type { Config } from "../config/schema";
import type { Role } from "../brain/prompt";

let config: Config;
let shuttingDown = false;

// Race condition guards — prevents overlapping cycles (ported from Meridian)
let _managementBusy = false;
let _screeningBusy = false;
let _screeningLastTriggered = 0;
const SCREENING_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown

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

/**
 * Dynamically adjust management interval based on position volatility.
 * Ported from Meridian: volatile positions need faster checks.
 */
function adjustManagementInterval(volatility: number): void {
    let targetInterval: number;
    if (volatility >= 5) {
        targetInterval = 3;
    } else if (volatility >= 2) {
        targetInterval = 5;
    } else {
        targetInterval = 10;
    }

    if (config.schedule.managementIntervalMin !== targetInterval) {
        const oldInterval = config.schedule.managementIntervalMin;
        config.schedule.managementIntervalMin = targetInterval;
        logger.info({ from: oldInterval, to: targetInterval, volatility }, "Management interval adjusted");

        // Reschedule management job with new interval
        const walletPubkey = getWallet().publicKey.toBase58();
        scheduleJob("MANAGER", targetInterval * 60 * 1000, async () => {
            if (_managementBusy) return;
            _managementBusy = true;
            try {
                const deps = await getWalletDeps(walletPubkey);
                await agentLoop("Monitor open positions, rebalance or close as needed", "MANAGER" as Role, config, deps);
            } finally {
                _managementBusy = false;
            }
        });
    }
}

async function getWalletDeps(walletPubkey: string) {
    try {
        const solBalance = await getSolBalance(walletPubkey);
        const tokenBalances = await getTokenBalances(walletPubkey);
        return { walletSolBalance: solBalance, walletTokenBalances: tokenBalances };
    } catch (error) {
        logger.warn({ error }, "Failed to fetch wallet balance, using 0");
        return { walletSolBalance: 0, walletTokenBalances: {} as Record<string, number> };
    }
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

    // 7. Schedule agent cycles with race condition guards
    const managementIntervalMs = config.schedule.managementIntervalMin * 60 * 1000;
    const screeningIntervalMs = config.schedule.screeningIntervalMin * 60 * 1000;
    const evolutionIntervalMs = config.schedule.evolutionIntervalHours * 60 * 60 * 1000;
    const healthIntervalMs = config.schedule.healthCheckIntervalMin * 60 * 1000;

    // Management cycle — with race condition guard
    scheduleJob("MANAGER", managementIntervalMs, async () => {
        if (_managementBusy) {
            logger.debug("Management cycle skipped — already busy");
            return;
        }
        _managementBusy = true;
        try {
            const deps = await getWalletDeps(walletPubkey);
            await agentLoop("Monitor open positions, rebalance or close as needed", "MANAGER" as Role, config, deps);

            // After management, check if screening should be triggered (ported from Meridian)
            const positions = getOpenPositions();
            if (
                positions.length < config.risk.maxPositions &&
                Date.now() - _screeningLastTriggered > SCREENING_COOLDOWN_MS
            ) {
                _screeningLastTriggered = Date.now();
                logger.info(
                    { positions: positions.length, max: config.risk.maxPositions },
                    "Slots available — triggering screening in background"
                );
                // Fire-and-forget screening
                runScreeningCycle(walletPubkey).catch(e =>
                    logger.error({ error: String(e) }, "Background screening failed")
                );
            }
        } finally {
            _managementBusy = false;
        }
    });

    // Screening cycle — with race condition guard
    scheduleJob("SCREENER", screeningIntervalMs, async () => {
        await runScreeningCycle(walletPubkey);
    });

    // Evolution cycle
    scheduleJob("EVOLVER", evolutionIntervalMs, async () => {
        const deps = await getWalletDeps(walletPubkey);
        await agentLoop("Analyze performance and propose strategy improvements", "EVOLVER" as Role, config, deps);
    });

    // Health check
    scheduleJob("HEALTH", healthIntervalMs, async () => {
        try {
            const solBalance = await getSolBalance(walletPubkey);
            const positions = getOpenPositions();
            logger.info({
                solBalance,
                positions: positions.length,
                jobs: listJobs().length,
                paused: isPaused(),
            }, "Health check OK");
        } catch (error) {
            logger.warn({ error }, "Health check failed");
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

/**
 * Screening cycle with race condition guard (ported from Meridian).
 */
async function runScreeningCycle(walletPubkey: string): Promise<void> {
    if (_screeningBusy) {
        logger.debug("Screening cycle skipped — already busy");
        return;
    }

    // Pre-check: at max positions?
    const positions = getOpenPositions();
    if (positions.length >= config.risk.maxPositions) {
        logger.info({ positions: positions.length, max: config.risk.maxPositions }, "Screening skipped — max positions");
        return;
    }

    _screeningBusy = true;
    _screeningLastTriggered = Date.now();
    try {
        const deps: any = await getWalletDeps(walletPubkey);

        // Pre-check: enough SOL?
        const minRequired = config.management.deployAmountSol + config.management.gasReserve;
        if (deps.walletSolBalance < minRequired) {
            logger.info({ sol: deps.walletSolBalance, needed: minRequired }, "Screening skipped — insufficient SOL");
            return;
        }

        logger.info("Pre-fetching top candidates before invoking SCREENER...");
        const { getTopCandidates } = await import("../strategy/screener");
        const candidates = await getTopCandidates(config);
        
        if (candidates.length === 0) {
            logger.info("No candidates found during pre-screening. Skipping agent loop.");
            return;
        }

        // Take top 5 to save context window, format as JSON string
        const top5 = candidates.slice(0, 5).map(c => ({
            token: `${c.tokenASymbol}/${c.tokenBSymbol}`,
            address: c.address,
            tvl: c.tvl,
            vol24h: c.volume24h,
            volatility: c.volatility,
            score: c.score,
            dexScreener: c.dexScreener ? {
                priceChange1h: c.dexScreener.priceChange1h,
                buySellRatio: c.dexScreener.buySellRatio24h,
                pairAge: c.dexScreener.pairAgeHours,
            } : null
        }));

        deps.preloadedData = `Top ${top5.length} Pre-Screened Candidates:\n${JSON.stringify(top5, null, 2)}`;
        
        logger.info({ preloadedCount: top5.length }, "Starting SCREENER loop with pre-loaded candidates");
        await agentLoop("Analyze the provided candidates and deploy capital to the best one.", "SCREENER" as Role, config, deps);
    } finally {
        _screeningBusy = false;
    }
}

/**
 * Graceful shutdown — reports open positions before exit (ported from Meridian).
 */
async function gracefulShutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Graceful shutdown initiated...");

    // Report open positions before shutting down
    try {
        const positions = getOpenPositions();
        logger.info({ openPositions: positions.length }, "Open positions at shutdown");

        // Notify via Telegram if configured
        if (config?.credentials?.telegramBotToken) {
            const chatIds = config.telegram?.authorizedChatIds || [];
            for (const chatId of chatIds) {
                await sendMessage(
                    chatId,
                    `⚠️ Agent shutting down.\nOpen positions: ${positions.length}\nPositions are NOT auto-closed. Restart to resume management.`,
                    ""
                ).catch(() => {});
            }
        }
    } catch {
        // Best-effort
    }

    stopAllJobs();
    stopBot();
    closeDb();
    logger.info("DLMM Agent shut down cleanly");
    process.exit(0);
}

// Export adjustManagementInterval so it can be called from tools after deploy
export { adjustManagementInterval };
