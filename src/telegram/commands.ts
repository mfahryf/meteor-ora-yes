// src/telegram/commands.ts
// Enhanced Telegram commands — ported from Meridian
// Supports: /start, /status, /positions, /close, /set, /briefing, /pause, /resume, /sim, /help

import { logger } from "../utils/logger";
import type { Config } from "../config/schema";
import { sendMessage } from "./bot";
import { getOpenPositions } from "../memory/positions";
import { getRecentTrades } from "../memory/trades";
import { getPerformanceMetrics } from "../memory/metrics";
import { getOpenShadowPositions, getDefaultPortfolio } from "../simulation/shadow-portfolio";
import { agentIsPaused, pauseAgent, resumeAgent } from "../core/lifecycle";

export async function handleTelegramCommand(chatId: string, text: string, config: Config): Promise<void> {
    const parts = text.split(/\s+/);
    let cmdName = parts[0].slice(1).toLowerCase().split("@")[0];

    try {
        switch (cmdName) {
            case "start":
            case "help":
                await cmdHelp(chatId);
                break;
            case "status":
                await cmdStatus(chatId, config);
                break;
            case "positions":
            case "pos":
                await cmdPositions(chatId);
                break;
            case "close":
                await cmdClose(chatId, parts.slice(1));
                break;
            case "set":
                await cmdSetNote(chatId, parts.slice(1));
                break;
            case "briefing":
                await cmdBriefing(chatId, config);
                break;
            case "pause":
                pauseAgent();
                await sendMessage(chatId, "⏸️ Agent paused. All cycles stopped.\nUse /resume to continue.", "");
                break;
            case "resume":
                resumeAgent();
                await sendMessage(chatId, "▶️ Agent resumed. Cycles restarted.", "");
                break;
            case "sim":
                await cmdSimStatus(chatId);
                break;
            case "pnl":
                await cmdPnl(chatId);
                break;
            case "lessons":
                await cmdLessons(chatId);
                break;
            default:
                // Unknown command, ignore
                break;
        }
    } catch (error) {
        logger.error({ error, command: cmdName }, "Failed to handle Telegram command");
        await sendMessage(chatId, `❌ Error: ${error instanceof Error ? error.message : String(error)}`, "");
    }
}

// ─── Help ──────────────────────────────────────────────────────────

async function cmdHelp(chatId: string) {
    await sendMessage(chatId, [
        "🤖 *DLMM Agent Commands*",
        "",
        "/status — Agent status, wallet, cycle timers",
        "/positions — List open positions with PnL",
        "/close <n> — Close position by number",
        "/set <n> <note> — Set instruction on position",
        "/pnl — Performance summary",
        "/briefing — Generate daily briefing",
        "/sim — Shadow trading status",
        "/pause — Pause all agent cycles",
        "/resume — Resume agent cycles",
        "/lessons — Show recent lessons",
        "/help — This help message",
    ].join("\n"));
}

// ─── Status ────────────────────────────────────────────────────────

async function cmdStatus(chatId: string, config: Config) {
    const positions = getOpenPositions();
    const paused = agentIsPaused();

    const lines = [
        "📊 *Agent Status*",
        "",
        `State: ${paused ? "⏸️ PAUSED" : "▶️ RUNNING"}`,
        `Mode: ${config.runtime.dryRun ? "🧪 DRY RUN" : "🔴 LIVE"}`,
        `Open positions: ${positions.length}/${config.risk.maxPositions}`,
        `Strategy: ${config.management.strategy}`,
        "",
        `*Schedule:*`,
        `  Management: every ${config.schedule.managementIntervalMin}min`,
        `  Screening: every ${config.schedule.screeningIntervalMin}min`,
        `  Evolution: every ${config.schedule.evolutionIntervalHours}h`,
        "",
        `*Screening:*`,
        `  TVL: $${config.screening.minTvl}–$${config.screening.maxTvl}`,
        `  Min Volume: $${config.screening.minVolume}`,
        `  DexScreener: ${config.dexScreener.enabled ? "✅" : "❌"}`,
        `  Debate: ${config.screening.useDebate ? "✅" : "❌"}`,
    ];

    await sendMessage(chatId, lines.join("\n"));
}

// ─── Positions ─────────────────────────────────────────────────────

async function cmdPositions(chatId: string) {
    const positions = getOpenPositions();

    if (positions.length === 0) {
        await sendMessage(chatId, "📭 No open positions.", "");
        return;
    }

    const lines = ["📊 *Open Positions*", ""];
    positions.forEach((p, i) => {
        lines.push(
            `${i + 1}. *${p.pool_address.slice(0, 8)}...*`,
            `   Strategy: ${p.strategy_type}`,
            `   Bin: ${p.min_bin}→${p.max_bin} (step ${p.bin_step})`,
            `   Status: ${p.status}`,
            "",
        );
    });

    lines.push("Use /close <n> to close | /set <n> <note> to set instruction");
    await sendMessage(chatId, lines.join("\n"));
}

// ─── Close ─────────────────────────────────────────────────────────

async function cmdClose(chatId: string, args: string[]) {
    if (args.length === 0) {
        await sendMessage(chatId, "Usage: /close <number>\nUse /positions first to see the list.", "");
        return;
    }

    const idx = parseInt(args[0]) - 1;
    const positions = getOpenPositions();

    if (idx < 0 || idx >= positions.length) {
        await sendMessage(chatId, `❌ Invalid number. You have ${positions.length} positions.`, "");
        return;
    }

    const pos = positions[idx];
    await sendMessage(chatId, `⏳ Closing position ${pos.pool_address.slice(0, 8)}...`, "");

    // Import and execute close tool
    try {
        const { executeTool } = await import("../tools/registry");
        const result = await executeTool("close_position", {
            position_address: pos.position_pubkey,
        });
        await sendMessage(chatId, `✅ Position closed.\n${JSON.stringify(result, null, 2)}`, "");
    } catch (error) {
        await sendMessage(chatId, `❌ Close failed: ${error instanceof Error ? error.message : String(error)}`, "");
    }
}

// ─── Set Note/Instruction ──────────────────────────────────────────

async function cmdSetNote(chatId: string, args: string[]) {
    if (args.length < 2) {
        await sendMessage(chatId, "Usage: /set <number> <instruction>\nExample: /set 1 close when PnL > 10%", "");
        return;
    }

    const idx = parseInt(args[0]) - 1;
    const note = args.slice(1).join(" ");
    const positions = getOpenPositions();

    if (idx < 0 || idx >= positions.length) {
        await sendMessage(chatId, `❌ Invalid number. You have ${positions.length} positions.`, "");
        return;
    }

    const pos = positions[idx];

    // Store note in pool_notes
    try {
        const { addPoolNote } = await import("../memory/pool-notes");
        addPoolNote(pos.pool_address, `[INSTRUCTION] ${note}`, "TELEGRAM");
        await sendMessage(chatId, `✅ Instruction set for position ${idx + 1}:\n"${note}"`, "");
    } catch (error) {
        await sendMessage(chatId, `❌ Failed: ${error instanceof Error ? error.message : String(error)}`, "");
    }
}

// ─── PnL ───────────────────────────────────────────────────────────

async function cmdPnl(chatId: string) {
    const metrics = getPerformanceMetrics(30);

    if (metrics.totalPositions === 0) {
        await sendMessage(chatId, "📊 No closed positions yet — no PnL data.", "");
        return;
    }

    const lines = [
        "📊 *Performance (30 days)*",
        "",
        `Positions: ${metrics.totalPositions} (${metrics.totalWins}W / ${metrics.totalLosses}L)`,
        `Win Rate: ${metrics.winRate.toFixed(1)}%`,
        `Avg PnL: ${metrics.avgPnlPct >= 0 ? "+" : ""}${metrics.avgPnlPct.toFixed(2)}%`,
        `Total PnL: ${metrics.totalPnlSol >= 0 ? "+" : ""}${metrics.totalPnlSol.toFixed(4)} SOL`,
        `Total Fees: ${metrics.totalFeesEarnedSol.toFixed(4)} SOL`,
        `Best: ${metrics.bestPnlPct >= 0 ? "+" : ""}${metrics.bestPnlPct.toFixed(1)}%`,
        `Worst: ${metrics.worstPnlPct.toFixed(1)}%`,
        `Sharpe: ${metrics.sharpeRatio.toFixed(2)}`,
    ];

    await sendMessage(chatId, lines.join("\n"));
}

// ─── Briefing ──────────────────────────────────────────────────────

async function cmdBriefing(chatId: string, config: Config) {
    await sendMessage(chatId, "📝 Generating daily briefing...", "");

    const positions = getOpenPositions();
    const metrics = getPerformanceMetrics(1); // last 24h
    const allMetrics = getPerformanceMetrics(30);
    const trades = getRecentTrades(10);

    const lines = [
        "📋 *Daily Briefing*",
        `📅 ${new Date().toISOString().slice(0, 10)}`,
        "",
        `*Portfolio:*`,
        `  Open positions: ${positions.length}/${config.risk.maxPositions}`,
        `  Strategy: ${config.management.strategy}`,
        "",
        `*Last 24h:*`,
        `  Trades: ${metrics.totalPositions}`,
        `  Win rate: ${metrics.winRate.toFixed(0)}%`,
        `  PnL: ${metrics.totalPnlSol >= 0 ? "+" : ""}${metrics.totalPnlSol.toFixed(4)} SOL`,
        `  Fees: ${metrics.totalFeesEarnedSol.toFixed(4)} SOL`,
        "",
        `*30-day Stats:*`,
        `  Total trades: ${allMetrics.totalPositions}`,
        `  Win rate: ${allMetrics.winRate.toFixed(0)}%`,
        `  Total PnL: ${allMetrics.totalPnlSol >= 0 ? "+" : ""}${allMetrics.totalPnlSol.toFixed(4)} SOL`,
        `  Sharpe: ${allMetrics.sharpeRatio.toFixed(2)}`,
    ];

    if (trades.length > 0) {
        lines.push("", "*Recent Trades:*");
        trades.slice(0, 5).forEach(t => {
            lines.push(`  ${t.action} ${t.amount_sol.toFixed(3)} SOL @ ${t.pool_address.slice(0, 8)}...`);
        });
    }

    await sendMessage(chatId, lines.join("\n"));
}

// ─── Shadow Sim Status ─────────────────────────────────────────────

async function cmdSimStatus(chatId: string) {
    try {
        const portfolio = getDefaultPortfolio();
        const openPositions = getOpenShadowPositions(portfolio.id);

        const lines = [
            "🔮 *Shadow Trading Status*",
            "",
            `Balance: ${portfolio.current_balance_sol.toFixed(4)} SOL`,
            `Initial: ${portfolio.initial_balance_sol.toFixed(4)} SOL`,
            `PnL: ${portfolio.total_pnl_pct >= 0 ? "+" : ""}${portfolio.total_pnl_pct.toFixed(1)}%`,
            `Opened: ${portfolio.positions_opened} | Closed: ${portfolio.positions_closed}`,
            `Win/Loss: ${portfolio.win_count}/${portfolio.loss_count}`,
            `Open now: ${openPositions.length}`,
        ];

        if (openPositions.length > 0) {
            lines.push("", "*Open Shadow Positions:*");
            openPositions.forEach((p, i) => {
                lines.push(`  ${i + 1}. ${p.token_a_symbol}/${p.token_b_symbol} | ${p.unrealized_pnl_pct.toFixed(1)}% | ${p.duration_minutes.toFixed(0)}min`);
            });
        }

        await sendMessage(chatId, lines.join("\n"));
    } catch {
        await sendMessage(chatId, "🔮 Shadow trading not initialized. Run simulation first.", "");
    }
}

// ─── Lessons ───────────────────────────────────────────────────────

async function cmdLessons(chatId: string) {
    try {
        const { listLessons } = await import("../memory/lessons");
        const result = await listLessons("SCREENER", false, 10);
        const lessons = Array.isArray(result) ? result : [];

        if (lessons.length === 0) {
            await sendMessage(chatId, "📚 No lessons recorded yet.", "");
            return;
        }

        const lines = ["📚 *Recent Lessons*", ""];
        for (const l of lessons.slice(0, 10)) {
            const pin = l.pinned ? "📌 " : "";
            lines.push(`${pin}[${l.role}] ${l.text.slice(0, 100)}`);
        }

        await sendMessage(chatId, lines.join("\n"));
    } catch {
        await sendMessage(chatId, "📚 Lessons system not available.", "");
    }
}
