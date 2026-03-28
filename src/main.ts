// src/main.ts
import { boot, getConfig } from "./core/lifecycle";
import { setRingBuffer } from "./utils/logger";
import { LogRingBuffer } from "./tui/log-capture";
import { TuiApp } from "./tui/tui-app";
import { getWallet } from "./chain/wallet";
import { getSolBalance, getTokenBalances } from "./chain/connection";

import { suppressStdoutForTui } from "./utils/logger";
import { logger } from "./utils/logger";

import type { Config } from "./config/schema";

import { agentIsPaused } from "./core/lifecycle"
import { listJobs } from "./core/scheduler"
import { getOpenPositions } from "./memory/positions"

const args = process.argv.slice(2);
const headless = args.includes("--headless");

async function main() {
    if (headless) {
        await boot();
        return;
    }

    // TUI mode — capture logs into ring buffer, suppress stdout
    const ringBuffer = new LogRingBuffer();
    setRingBuffer(ringBuffer);
    suppressStdoutForTui();

    await boot();
    const config = getConfig();

    let solBalance = 0;
    let tokenBalances: Record<string, number> = {};
    try {
        const wallet = getWallet();
        solBalance = await getSolBalance(wallet.publicKey);
        tokenBalances = await getTokenBalances(wallet.publicKey);
    } catch {
        // Non-fatal
    }

    // Start TUI
    const app = new TuiApp();
    app.updateWallet(solBalance, tokenBalances);
    await app.start(config, ringBuffer);
    process.exit(0);
}

main().catch((error) => {
    console.error("Fatal error during boot:", error);
    process.exit(1);
});
