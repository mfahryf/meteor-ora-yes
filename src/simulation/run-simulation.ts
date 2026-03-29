// src/simulation/run-simulation.ts
// CLI entry point for shadow trading simulation
// Usage: npx tsx src/simulation/run-simulation.ts [--cycles N] [--interval M] [--balance B]

import { initDb } from "../memory/sqlite";
import { loadConfig } from "../config/loader";
import { createPortfolio, getDefaultPortfolio } from "./shadow-portfolio";
import { runSimulationCycle, getSimulationReport } from "./simulator";
import { logger } from "../utils/logger";

async function main() {
    // Parse args
    const args = process.argv.slice(2);
    const getArg = (name: string, defaultVal: string) => {
        const idx = args.indexOf(`--${name}`);
        return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
    };

    const totalCycles = parseInt(getArg("cycles", "10"));
    const intervalMinutes = parseInt(getArg("interval", "5"));
    const initialBalance = parseFloat(getArg("balance", "1.0"));

    const isInfinite = totalCycles === 0;
    const isReset = args.includes("--reset");
    const cycleDisplay = isInfinite ? "∞" : String(totalCycles).padEnd(4);

    console.log(`
╔══════════════════════════════════════════════════════╗
║           🔮 SHADOW TRADING SIMULATOR                ║
║                                                      ║
║  Real market data → Virtual SOL → Real learnings     ║
╠══════════════════════════════════════════════════════╣
║  Cycles: ${cycleDisplay} │ Interval: ${String(intervalMinutes).padEnd(3)}min │ Balance: ${initialBalance} SOL  ║
╚══════════════════════════════════════════════════════╝
`);

    // Init
    const config = loadConfig();
    initDb();

    if (isReset) {
        console.log(`🧹 Resetting all shadow positions and portfolios...`);
        const { getDb } = await import("../memory/sqlite");
        const db = getDb();
        db.prepare("DELETE FROM shadow_positions").run();
        db.prepare("DELETE FROM shadow_portfolios").run();
        // Reset sqlite autoincrement sequences (may not exist on fresh DB)
        try { db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('shadow_positions', 'shadow_portfolios')").run(); } catch {}
        console.log(`✅ Reset complete! Starting fresh simulation.\n`);
    }

    // Create or get portfolio
    let portfolio = getDefaultPortfolio();
    if (portfolio.initial_balance_sol !== initialBalance) {
        // Create new portfolio with requested balance
        portfolio = createPortfolio(`sim_${Date.now()}`, initialBalance);
    }

    console.log(`📊 Portfolio: ${portfolio.name}`);
    console.log(`💰 Starting balance: ${portfolio.current_balance_sol.toFixed(4)} SOL`);
    console.log(`📈 Open positions: ${portfolio.positions_opened - portfolio.positions_closed}`);
    console.log(`\n--- Starting simulation (Press Ctrl+C to stop) ---\n`);

    // Start telegram bot for simulation
    const { startBot, broadcastMessage } = await import("../telegram/bot");
    await startBot(config);
    console.log(`🤖 Telegram bot started! Send any message to your bot to auto-register and receive live updates.`);

    // Run cycles
    let cycle = 1;
    while (isInfinite || cycle <= totalCycles) {
        process.stdout.write(`\n━━━ Cycle ${cycle}${isInfinite ? "" : `/${totalCycles}`} ━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

        try {
            const result = await runSimulationCycle(config, cycle);

            // Print cycle summary
            console.log(`  Screened: ${result.screened} pools | Deployed: ${result.deployed} | Monitored: ${result.monitored} | Closed: ${result.closed}`);
            console.log(`  Balance: ${result.portfolioBalance.toFixed(4)} SOL (${result.portfolioPnlPct >= 0 ? "+" : ""}${result.portfolioPnlPct.toFixed(1)}%)`);

            // --- Tampilkan Kondisi Pool (Top Candidates) ---
            if (result.topCandidates && result.topCandidates.length > 0) {
                console.log(`\n  🌟 Top 5 Pool Ditemukan (Screening):`);
                result.topCandidates.forEach((c, i) => {
                    const age = c.dexScreener?.pairAgeHours ? `${c.dexScreener?.pairAgeHours.toFixed(1)}h` : "?";
                    const bsRatio = c.dexScreener?.buySellRatio24h ? c.dexScreener?.buySellRatio24h.toFixed(1) : "?";
                    const pc = c.dexScreener?.priceChange1h ? `${c.dexScreener.priceChange1h >= 0 ? '+' : ''}${c.dexScreener.priceChange1h.toFixed(1)}%` : "?";
                    
                    console.log(`    ${i + 1}. ${c.tokenASymbol}/${c.tokenBSymbol} | TVL: $${c.tvl.toFixed(0)} | Umur: ${age} | B/S: ${bsRatio} | 1h: ${pc}`);
                });
            }

            if (result.errors.length > 0) {
                console.log(`  ⚠️ Errors: ${result.errors.length}`);
                result.errors.forEach(e => console.log(`    - ${e}`));
            }

            let tgMessage = `🔄 *Simulation Cycle ${cycle}*\n\n`;
            tgMessage += `Screened: ${result.screened} pools | Deployed: ${result.deployed}\n`;
            tgMessage += `Balance: *${result.portfolioBalance.toFixed(4)} SOL* (${result.portfolioPnlPct >= 0 ? "+" : ""}${result.portfolioPnlPct.toFixed(1)}%)\n`;

            if (result.topCandidates && result.topCandidates.length > 0) {
                tgMessage += `\n🌟 *Top 3 Screens:*\n`;
                result.topCandidates.slice(0, 3).forEach((c, i) => {
                    tgMessage += `  ${i + 1}. ${c.tokenASymbol}/${c.tokenBSymbol} | $${c.tvl.toFixed(0)}\n`;
                });
            }

            // --- Tampilkan Status Posisi Aktif ---
            const { getOpenShadowPositions } = await import("./shadow-portfolio");
            const openPos = getOpenShadowPositions(portfolio.id);
            if (openPos.length > 0) {
                let totalFees = 0;
                let totalDeployed = 0;

                console.log(`\n  📡 LLM Manager Evaluation (Simulated):`);
                openPos.forEach((p) => {
                    const ageStr = `${p.duration_minutes.toFixed(0)}m`;
                    const unclaimedStr = `${p.accumulated_fees_sol.toFixed(4)} SOL`;
                    const pnlStr = `${p.unrealized_pnl_pct >= 0 ? '+' : ''}${p.unrealized_pnl_pct.toFixed(2)}%`;
                    
                    // Calculate 10-char compact range bar
                    const totalBins = Math.max(1, p.bins_below + p.bins_above);
                    const binRangePct = (p.bin_step * totalBins / 10000) * 100;
                    const pc = p.price_change_pct;
                    
                    let bar = "██████████";
                    let msg = "IN RNG";
                    
                    if (Math.abs(pc) > binRangePct) {
                        bar = "░░░░░░░░░░";
                        msg = "OUT RNG";
                    } else if (Math.abs(pc) > binRangePct * 0.8) {
                        bar = pc > 0 ? "████████░░" : "░░████████";
                        msg = pc > 0 ? "UPR EDG" : "LWR EDG";
                    }
                    
                    const rangeInfo = `${pc >= 0 ? '+' : ''}${pc.toFixed(2)}% / ±${binRangePct.toFixed(1)}%`;
                    const valueSol = (p.entry_amount_sol + p.unrealized_pnl_sol).toFixed(4);
                    const debateStr = p.debate_arbiter_score ? `🤖 Arb: ${p.debate_arbiter_score}/100` : "🤖 No Debate";

                    console.log(`  [${bar}] ${msg.padEnd(7)} | ${rangeInfo.padEnd(16)} | ${(p.token_a_symbol + "/" + p.token_b_symbol).padEnd(10)} | Age: ${ageStr.padEnd(4)} | PnL: ${pnlStr.padStart(7)} | Fees: ${unclaimedStr} | Val: ${valueSol} SOL | ${debateStr}`);
                    
                    totalFees += p.accumulated_fees_sol;
                    totalDeployed += (p.entry_amount_sol + p.unrealized_pnl_sol);

                    // Add to telegram broadcast
                    tgMessage += `\n[${bar}] ${msg}\n${p.token_a_symbol}/${p.token_b_symbol} | Age: ${ageStr}\nPnL: ${pnlStr} | Fees: ${unclaimedStr}\n`;
                });
                console.log(`\n  💼 ${openPos.length} pos | Total: ${totalDeployed.toFixed(4)} SOL | Total Fees: ${totalFees.toFixed(4)} SOL`);
                tgMessage += `\n💼 ${openPos.length} pos | Total: ${totalDeployed.toFixed(4)} SOL`;
            } else {
                console.log(`\n  📭 Tidak ada posisi yang aktif saat ini.`);
            }

            // Send to telegram (silently)
            broadcastMessage(tgMessage).catch(() => {});

        } catch (error) {
            console.error(`  ❌ Cycle failed: ${error}`);
        }

        // Wait between cycles (unless last of finite run)
        if (isInfinite || cycle < totalCycles) {
            console.log(`\n  ⏳ Next cycle in ${intervalMinutes}min...`);
            await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
        }
        cycle++;
    }

    // Final report
    const report = getSimulationReport(portfolio.id);

    console.log(`
╔══════════════════════════════════════════════════════╗
║               📊 SIMULATION REPORT                   ║
╠══════════════════════════════════════════════════════╣
║  Initial Balance:  ${String(report.portfolio.initial_balance_sol.toFixed(4) + " SOL").padEnd(33)}║
║  Final Balance:    ${String(report.portfolio.current_balance_sol.toFixed(4) + " SOL").padEnd(33)}║
║  Total PnL:        ${String((report.portfolio.total_pnl_sol >= 0 ? "+" : "") + report.portfolio.total_pnl_sol.toFixed(4) + " SOL (" + report.portfolio.total_pnl_pct.toFixed(1) + "%)").padEnd(33)}║
║  Total Fees:       ${String(report.portfolio.total_fees_earned_sol.toFixed(4) + " SOL").padEnd(33)}║
╠══════════════════════════════════════════════════════╣
║  Positions Opened: ${String(report.portfolio.positions_opened).padEnd(33)}║
║  Positions Closed: ${String(report.portfolio.positions_closed).padEnd(33)}║
║  Still Open:       ${String(report.openPositions.length).padEnd(33)}║
║  Win Rate:         ${String(report.winRate.toFixed(1) + "%").padEnd(33)}║
║  Avg PnL:          ${String(report.avgPnlPct.toFixed(2) + "%").padEnd(33)}║
╠══════════════════════════════════════════════════════╣`);

    if (report.bestTrade) {
        console.log(`║  Best Trade:       ${String(report.bestTrade.token_a_symbol + "/" + report.bestTrade.token_b_symbol + " " + (report.bestTrade.final_pnl_pct >= 0 ? "+" : "") + report.bestTrade.final_pnl_pct?.toFixed(1) + "%").padEnd(33)}║`);
    }
    if (report.worstTrade) {
        console.log(`║  Worst Trade:      ${String(report.worstTrade.token_a_symbol + "/" + report.worstTrade.token_b_symbol + " " + report.worstTrade.final_pnl_pct?.toFixed(1) + "%").padEnd(33)}║`);
    }

    console.log(`╚══════════════════════════════════════════════════════╝`);
}

main().catch(console.error);
