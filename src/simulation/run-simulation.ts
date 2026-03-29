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

    console.log(`
╔══════════════════════════════════════════════════════╗
║           🔮 SHADOW TRADING SIMULATOR                ║
║                                                      ║
║  Real market data → Virtual SOL → Real learnings     ║
╠══════════════════════════════════════════════════════╣
║  Cycles: ${String(totalCycles).padEnd(4)} │ Interval: ${String(intervalMinutes).padEnd(3)}min │ Balance: ${initialBalance} SOL  ║
╚══════════════════════════════════════════════════════╝
`);

    // Init
    const config = loadConfig();
    initDb();

    // Create or get portfolio
    let portfolio = getDefaultPortfolio();
    if (portfolio.initial_balance_sol !== initialBalance) {
        // Create new portfolio with requested balance
        portfolio = createPortfolio(`sim_${Date.now()}`, initialBalance);
    }

    console.log(`📊 Portfolio: ${portfolio.name}`);
    console.log(`💰 Starting balance: ${portfolio.current_balance_sol.toFixed(4)} SOL`);
    console.log(`📈 Open positions: ${portfolio.positions_opened - portfolio.positions_closed}`);
    console.log(`\n--- Starting simulation ---\n`);

    // Run cycles
    for (let cycle = 1; cycle <= totalCycles; cycle++) {
        console.log(`\n━━━ Cycle ${cycle}/${totalCycles} ━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        try {
            const result = await runSimulationCycle(config, cycle);

            // Print cycle summary
            console.log(`  Screened: ${result.screened} pools`);
            console.log(`  Deployed: ${result.deployed} shadow positions`);
            console.log(`  Monitored: ${result.monitored} positions`);
            console.log(`  Closed: ${result.closed} positions`);
            console.log(`  Balance: ${result.portfolioBalance.toFixed(4)} SOL (${result.portfolioPnlPct >= 0 ? "+" : ""}${result.portfolioPnlPct.toFixed(1)}%)`);

            if (result.errors.length > 0) {
                console.log(`  ⚠️ Errors: ${result.errors.length}`);
                result.errors.forEach(e => console.log(`    - ${e}`));
            }
        } catch (error) {
            console.error(`  ❌ Cycle failed: ${error}`);
        }

        // Wait between cycles (unless last)
        if (cycle < totalCycles) {
            console.log(`\n  ⏳ Next cycle in ${intervalMinutes}min...`);
            await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
        }
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
