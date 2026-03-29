// src/cli/test-screener.ts
// Utility script to manually test the screening pipeline
// Usage: bun run src/cli/test-screener.ts

import { loadConfig } from "../config/loader";
import { getTopCandidates } from "../strategy/screener";
import { logger } from "../utils/logger";

async function main() {
    console.log(`
╔══════════════════════════════════════════════════════╗
║              🔍 MANUAL SCREENER TEST                 ║
║   Testing Meteora Discovery + DexScreener Filters    ║
╚══════════════════════════════════════════════════════╝
`);

    const config = loadConfig();
    
    console.log(`📋 Active Screening Config:`);
    console.log(`  - TVL: $${config.screening.minTvl} -> $${config.screening.maxTvl}`);
    console.log(`  - Volume (24h): > $${config.screening.minVolume}`);
    console.log(`  - DexScreener: ${config.dexScreener.enabled ? 'ON' : 'OFF'}`);
    console.log(`\n⏳ Fetching pools from Meteora...`);

    const startTime = Date.now();
    
    try {
        const candidates = await getTopCandidates(config);
        const durationMs = Date.now() - startTime;

        console.log(`\n✅ Screening complete in ${(durationMs / 1000).toFixed(1)}s`);
        console.log(`📊 Total candidates passing all filters: ${candidates.length}\n`);

        if (candidates.length === 0) {
            console.log(`❌ No pools match your current config limits.`);
            return;
        }

        console.log(`🏆 TOP 5 CANDIDATES:`);
        console.log(`──────────────────────────────────────────────────────────`);
        
        candidates.slice(0, 5).forEach((c, idx) => {
            console.log(`${idx + 1}. ${c.tokenASymbol}/${c.tokenBSymbol} (${c.address})`);
            console.log(`   💰 TVL: $${c.tvl.toFixed(0)} | Vol 24h: $${c.volume24h.toFixed(0)}`);
            console.log(`   ⚡ Volatility: ${c.volatility?.toFixed(2)} | Bin Step: ${c.binStep}`);
            
            if (c.dexScreener) {
                const ds = c.dexScreener;
                console.log(`   📊 DexScreener Data:`);
                console.log(`      • Age: ${ds.pairAgeHours.toFixed(1)}h`);
                console.log(`      • Buy/Sell Ratio: ${ds.buySellRatio24h.toFixed(2)} (${ds.buys24h} / ${ds.sells24h})`);
                console.log(`      • Price 1h: ${ds.priceChange1h >= 0 ? '+' : ''}${ds.priceChange1h}% | 24h: ${ds.priceChange24h >= 0 ? '+' : ''}${ds.priceChange24h}%`);
                console.log(`      • Liquidity: $${ds.liquidityUsd?.toFixed(0) || "N/A"}`);
            }
            console.log(`──────────────────────────────────────────────────────────`);
        });

    } catch (error) {
        logger.error({ error }, "Manual screening test failed");
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

main().catch(console.error);
