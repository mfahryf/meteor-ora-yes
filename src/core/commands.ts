// src/core/commands.ts
// Shared command handlers — used by both TUI and Telegram

import { getOpenPositions } from "../memory/positions";
import { getTotalFeesClaimed } from "../memory/fees";
import { getRecentRuns } from "../memory/runs";
import { pauseAgent, resumeAgent, agentIsPaused } from "./lifecycle";
import { listJobs } from "./scheduler";
import { clearSession } from "../telegram/session";
import type { Config } from "../config/schema";

import { agentLoop } from "../brain/agent";

export interface CommandContext {
    config: Config;
    walletSolBalance: number;
    walletTokenBalances: Record<string, number>;
    sessionId: string;
}

export interface CommandResult {
    text: string;
    success: boolean;
}

type CommandFn = (ctx: CommandContext, args: string[]) => Promise<CommandResult>;

interface CommandEntry {
    fn: CommandFn;
    description: string;
}

const COMMANDS: Record<string, CommandEntry> = {
    auto: {
        description: "Screen top pools and auto deploy",
        fn: async (ctx) => {
            try {
                const result = await agentLoop(
                    "Screen the top trending pools, analyze them, and automatically deploy liquidity into the best candidates according to my risk config.",
                    "SCREENER",
                    ctx.config,
                    {
                        walletSolBalance: ctx.walletSolBalance,
                        walletTokenBalances: ctx.walletTokenBalances,
                    }
                );
                return { success: true, text: `Auto-deploy run completed:\n\n${result.content}` };
            } catch (error) {
                return { success: false, text: `Auto-deployment failed: ${error}` };
            }
        },
    },
    exit: {
        description: "Exit TUI",
        fn: async () => ({
            success: true,
            text: "__QUIT__",
        }),
    },
    learn: {
        description: "Learn pool behavior (<address>)",
        fn: async (ctx, args) => {
            const address = args?.[0];
            if (!address) {
                return { success: false, text: "Please provide a pool address: /learn <address>" };
            }
            try {
                const result = await agentLoop(
                    `Analyze the pool at address ${address}. Learn its behavior, volatility, and trading patterns, and save these observations into memory lessons.`,
                    "EVOLVER",
                    ctx.config,
                    {
                        walletSolBalance: ctx.walletSolBalance,
                        walletTokenBalances: ctx.walletTokenBalances,
                    }
                );
                return {
                    success: true,
                    text: `Learning initiated for pool ${address}:\n\n${result.content}`,
                };
            } catch (error) {
                return { success: false, text: `Learning failed: ${error}` };
            }
        },
    },
    start: {
        description: "Show welcome message",
        fn: async () => ({
            success: true,
            text:
                "DLMM Agent Started.\n\n" +
                "Commands:\n" +
                "/status - Portfolio & positions\n" +
                "/pause - Pause all cycles\n" +
                "/resume - Resume cycles\n" +
                "/positions - Open positions\n" +
                "/pnl - Performance summary\n" +
                "/lessons - Recent lessons\n" +
                "/clear - Clear chat history\n" +
                "/help - Show all commands",
        }),
    },
    status: {
        description: "Portfolio overview",
        fn: async (ctx) => {
            const positions = getOpenPositions();
            const fees = getTotalFeesClaimed();
            const runs = getRecentRuns(5);

            const lines = [
                "Portfolio Status",
                `Positions: ${positions.length}/${ctx.config.risk.maxPositions}`,
                `SOL: ${ctx.walletSolBalance.toFixed(4)}`,
                `Fees claimed: ${fees.totalFeeA.toFixed(4)} A, ${fees.totalFeeB.toFixed(2)} B`,
                `Recent runs: ${runs.length}`,
                `Dry run: ${ctx.config.runtime.dryRun ? "ON" : "OFF"}`,
                `Status: ${agentIsPaused() ? "PAUSED" : "RUNNING"}`,
                `Active jobs: ${listJobs().length}`,
            ];

            if (runs.length > 0) {
                const last = runs[0];
                lines.push(`Last run: ${last.agent_type} | ${last.success ? "OK" : "FAIL"} | ${last.duration_ms}ms`);
            }

            return { success: true, text: lines.join("\n") };
        },
    },
    positions: {
        description: "Open positions",
        fn: async () => {
            const positions = getOpenPositions();
            if (positions.length === 0) {
                return { success: true, text: "No open positions." };
            }

            const lines = positions.map((p, i) =>
                `${i + 1}. ${p.pool_address}\n` +
                `   Strategy: ${p.strategy_type} | Bins: ${p.min_bin}..${p.max_bin}\n` +
                `   Amount: X=${p.amount_x} Y=${p.amount_y}`
            );
            return { success: true, text: lines.join("\n\n") };
        },
    },
    pnl: {
        description: "Performance summary",
        fn: async () => {
            const fees = getTotalFeesClaimed();
            const runs = getRecentRuns(20);
            const successRate = runs.length > 0
                ? (runs.filter(r => r.success).length / runs.length * 100).toFixed(1)
                : "N/A";

            return {
                success: true,
                text:
                    `Performance\n` +
                    `Total fees claimed: ${fees.totalFeeA.toFixed(4)} A, ${fees.totalFeeB.toFixed(2)} B\n` +
                    `Recent runs: ${runs.length}\n` +
                    `Success rate: ${successRate}%`,
            };
        },
    },
    pause: {
        description: "Pause all agent cycles",
        fn: async () => {
            pauseAgent();
            return { success: true, text: "Agent paused. All scheduled jobs stopped. Use /resume to restart." };
        },
    },
    resume: {
        description: "Resume agent cycles",
        fn: async () => {
            resumeAgent();
            return { success: true, text: "Agent resumed. Scheduled jobs are active again." };
        },
    },
    clear: {
        description: "Clear chat history",
        fn: async (ctx) => {
            clearSession(ctx.sessionId);
            return { success: true, text: "Chat history cleared." };
        },
    },
    lessons: {
        description: "View learned lessons",
        fn: async () => {
            // Lessons are in Qdrant — just show a placeholder for now
            return { success: true, text: "Lesson listing not yet available in CLI. Use the agent chat to query lessons." };
        },
    },
    help: {
        description: "Show all commands",
        fn: async () => ({
            success: true,
            text:
                "Available Commands:\n\n" +
                "/auto - Screen top pools & deploy\n" +
                "/learn <address> - Learn pool behavior\n" +
                "/status - Portfolio overview\n" +
                "/positions - Open positions\n" +
                "/pnl - Performance summary\n" +
                "/pause - Pause agent cycles\n" +
                "/resume - Resume agent cycles\n" +
                "/lessons - View learned lessons\n" +
                "/clear - Clear chat history\n" +
                "/exit - Exit TUI\n" +
                "/help - Show this message\n\n" +
                "Or type a message to chat with the agent.",
        }),
    },
    quit: {
        description: "Shutdown agent",
        fn: async () => ({
            success: true,
            text: "__QUIT__",
        }),
    },
};

export async function dispatchCommand(name: string, ctx: CommandContext, args: string[] = []): Promise<CommandResult> {
    const entry = COMMANDS[name];
    if (!entry) {
        return { success: false, text: `Unknown command: /${name}. Type /help for available commands.` };
    }
    try {
        return await entry.fn(ctx, args);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, text: `Error: ${msg}` };
    }
}

export function listCommands(): Array<{ name: string; description: string }> {
    return Object.entries(COMMANDS)
        .filter(([name]) => name !== "quit")
        .map(([name, entry]) => ({ name, description: entry.description }));
}

export function getCommandHelpText(): string {
    return listCommands().map(c => `/${c.name}`).join("  ");
}
