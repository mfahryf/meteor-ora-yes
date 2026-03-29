// src/tools/register.ts
// Convenience function to register all DLMM agent tools at once

import { registerTool } from "./registry";
import { discoverPools, getPoolDetail, searchPools, getPoolOHLCV, getPoolVolumeHistory } from "../chain/scanner";
import { getDlmmPool, deployPosition, closePosition, claimFees, getActiveBin } from "../chain/dlmm";
import { executeSwap } from "../chain/jupiter";
import { getWalletBalances } from "../chain/wallet-balances";
import { getSolBalance, getTokenBalances } from "../chain/connection";
import { insertTrade } from "../memory/trades";
import { insertFeeClaim } from "../memory/fees";
import { insertPosition, getOpenPositions, updatePositionStatus } from "../memory/positions";
import { addLesson, listLessons, pinLesson, unpinLesson } from "../memory/lessons";
import { getRecentTrades } from "../memory/trades";
import { getTotalFeesClaimed } from "../memory/fees";
import { addPoolNote, getPoolNotes } from "../memory/pool-notes";
import { getTokenInfo, getTokenHolders, getTokenNarrative } from "../chain/token-research";
import { studyTopLPers } from "../chain/lpagent";
import { logger } from "../utils/logger";
import type { Config } from "../config/schema";
import type { Connection, Keypair } from "@solana/web3.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export function registerAllTools(config: Config, connection: Connection, wallet: Keypair): void {
    // Screening
    registerTool("discover_pools", async (args: any) => discoverPools(args));
    registerTool("get_top_candidates", async (args: any) => discoverPools({ ...config.screening, limit: args.limit || 10 }));
    registerTool("get_pool_detail", async (args: any) => getPoolDetail(args.pool_address));
    registerTool("search_pools", async (args: any) => searchPools(args.query, args.limit));
    registerTool("get_pool_ohlcv", async (args: any) => getPoolOHLCV(args.pool_address, args.timeframe, args.start_time, args.end_time));
    registerTool("get_pool_volume_history", async (args: any) => getPoolVolumeHistory(args.pool_address, args.timeframe, args.start_time, args.end_time));

    // Position Management
    registerTool("deploy_position", async (args: any) => {
        const result = await deployPosition(connection, wallet, args);
        insertTrade({
            position_pubkey: result.positionPubkey,
            pool_address: args.pool_address,
            token_a: "SOL",
            token_b: args.token_b || "UNKNOWN",
            action: "open",
            amount_sol: args.amount_sol,
            amount_token: 0,
            tx_signature: result.txSignature,
        });
        insertPosition({
            position_pubkey: result.positionPubkey,
            pool_address: args.pool_address,
            strategy_type: args.strategy_type,
            bin_step: args.bin_step,
            min_bin: args.min_bin,
            max_bin: args.max_bin,
            amount_x: args.amount_sol,
            amount_y: 0,
            status: "open",
        });
        return result;
    });

    registerTool("close_position", async (args: any) => {
        const result = await closePosition(connection, wallet, args.position_pubkey, args.pool_address);
        insertTrade({
            position_pubkey: args.position_pubkey,
            pool_address: args.pool_address,
            token_a: "SOL",
            token_b: "UNKNOWN",
            action: "close",
            amount_sol: 0,
            amount_token: 0,
            tx_signature: result.txSignature,
        });

        // Auto-swap: swap base token to SOL if >= $0.10
        if (args.base_mint && args.base_mint !== SOL_MINT) {
            try {
                const balances = await getWalletBalances(wallet.publicKey.toBase58());
                const baseToken = balances.tokens.find(t => t.mint === args.base_mint);
                if (baseToken && baseToken.valueUsd >= 0.10 && baseToken.amount > 0) {
                    logger.info({ mint: args.base_mint, valueUsd: baseToken.valueUsd }, "Auto-swapping base token after close");
                    // Use raw amount (smallest unit) for swap
                    const rawAmount = Math.floor(baseToken.amount * Math.pow(10, baseToken.decimals));
                    const swapResult = await executeSwap(connection, wallet, args.base_mint, SOL_MINT, rawAmount, 100);
                    logger.info({ txSig: swapResult.txSignature }, "Auto-swap after close completed");
                }
            } catch (swapError) {
                logger.warn({ error: String(swapError) }, "Auto-swap after close failed (non-critical)");
            }
        }

        return result;
    });

    registerTool("claim_fees", async (args: any) => {
        const result = await claimFees(connection, wallet, args.position_pubkey, args.pool_address);
        insertFeeClaim({
            position_pubkey: args.position_pubkey,
            fee_a: 0,
            fee_b: 0,
            tx_signature: result.txSignature,
        });

        // Auto-swap: swap claimed token to SOL if configured
        if (config.management.autoSwapAfterClaim && args.base_mint && args.base_mint !== SOL_MINT) {
            try {
                const balances = await getWalletBalances(wallet.publicKey.toBase58());
                const baseToken = balances.tokens.find(t => t.mint === args.base_mint);
                if (baseToken && baseToken.valueUsd >= 0.10 && baseToken.amount > 0) {
                    logger.info({ mint: args.base_mint, valueUsd: baseToken.valueUsd }, "Auto-swapping claimed token");
                    const rawAmount = Math.floor(baseToken.amount * Math.pow(10, baseToken.decimals));
                    const swapResult = await executeSwap(connection, wallet, args.base_mint, SOL_MINT, rawAmount, 100);
                    logger.info({ txSig: swapResult.txSignature }, "Auto-swap after claim completed");
                }
            } catch (swapError) {
                logger.warn({ error: String(swapError) }, "Auto-swap after claim failed (non-critical)");
            }
        }

        return result;
    });

    registerTool("withdraw_liquidity", async (args: any) => {
        const result = await closePosition(connection, wallet, args.position_pubkey, args.pool_address);
        return { ...result, action: "withdraw_liquidity" };
    });

    registerTool("add_liquidity", async (args: any) => {
        // Re-deploy into existing position using pool's addLiquidity
        const pool = await getDlmmPool(connection, args.pool_address);
        try {
            const { transactions } = await pool.addLiquidityByWeight({
                position: args.position_pubkey,
                user: wallet.publicKey,
                totalXAmount: args.amount_sol ?? 0,
                totalYAmount: args.amount_token ?? 0,
                bins: [], // uses existing bin range
            });
            let lastSig = "";
            for (const tx of transactions) {
                tx.partialSign(wallet);
                const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
                await connection.confirmTransaction(sig, "confirmed");
                lastSig = sig;
            }
            return { txSignature: lastSig, action: "add_liquidity" };
        } catch (error) {
            throw new Error(`Failed to add liquidity: ${error instanceof Error ? error.message : error}`);
        }
    });

    registerTool("get_active_bin", async (args: any) => getActiveBin(connection, args.pool_address));
    registerTool("get_my_positions", async () => getOpenPositions());

    // Wallet — Helius USD balances
    registerTool("get_wallet_balance", async () => {
        try {
            return await getWalletBalances(wallet.publicKey.toBase58());
        } catch (error) {
            // Fallback to RPC-based balance
            logger.warn({ error }, "Helius balance failed, falling back to RPC");
            try {
                const sol = await getSolBalance(wallet.publicKey);
                const tokens = await getTokenBalances(wallet.publicKey);
                return { publicKey: wallet.publicKey.toBase58(), sol, tokens, solValueUsd: 0, totalValueUsd: 0 };
            } catch (fallbackError) {
                return { publicKey: wallet.publicKey.toBase58(), sol: 0, tokens: {}, error: "balance fetch failed" };
            }
        }
    });

    registerTool("swap_token", async (args: any) => {
        return executeSwap(connection, wallet, args.input_mint, args.output_mint, args.amount, args.slippage_bps);
    });

    // Token Research — real API-backed
    registerTool("get_token_info", async (args: any) => getTokenInfo(args.mint));
    registerTool("get_token_holders", async (args: any) => getTokenHolders(args.mint, args.limit || 10));
    registerTool("get_token_narrative", async (args: any) => getTokenNarrative(args.mint));

    // Top LPers — Meteora API-based
    registerTool("get_top_lpers", async (args: any) => {
        try {
            const detail = await getPoolDetail(args.pool_address);
            return { pool: args.pool_address, lpers: [], tvl: detail.tvl, volume24h: detail.volume24h };
        } catch {
            return { pool: args.pool_address, lpers: [], error: "Could not fetch pool data" };
        }
    });
    registerTool("study_top_lpers", async (args: any) => {
        return studyTopLPers(args.pool_address, args.limit || 10);
    });

    // Position notes — persistent instructions
    registerTool("set_position_note", async (args: any) => {
        addPoolNote(args.pool_address, args.note, args.agent_type || "manager");
        return { pool: args.pool_address, note: args.note, saved: true };
    });

    // Smart Wallets — SQLite-backed
    registerTool("check_smart_wallets_on_pool", async (args: any) => {
        const { listSmartWallets } = await import("../memory/smart-wallets");
        const allWallets = listSmartWallets();
        return { pool: args.pool_address, wallets: allWallets.map(w => w.address) };
    });
    registerTool("add_smart_wallet", async (args: any) => {
        const { addSmartWallet } = await import("../memory/smart-wallets");
        addSmartWallet(args.address, args.label || "");
        return { added: args.address };
    });
    registerTool("remove_smart_wallet", async (args: any) => {
        const { removeSmartWallet } = await import("../memory/smart-wallets");
        const removed = removeSmartWallet(args.address);
        return { removed: removed ? args.address : null };
    });
    registerTool("list_smart_wallets", async () => {
        const { listSmartWallets } = await import("../memory/smart-wallets");
        const wallets = listSmartWallets();
        return { wallets };
    });

    // Memory & Learning
    registerTool("add_lesson", async (args: any) => {
        const { v4: uuidv4 } = await import("uuid");
        const { getEmbedding } = await import("../brain/embeddings");
        // Generate real embedding (or hash-based fallback) instead of dummy zeros
        const vector = await getEmbedding(
            args.text,
            config.llm.baseUrl,
            config.llm.apiKey,
        );
        await addLesson({ id: uuidv4(), text: args.text, role: args.role, pinned: false, tags: args.tags || [], createdAt: new Date().toISOString() }, vector);
        return { saved: true };
    });
    registerTool("list_lessons", async (args: any) => listLessons(args.role, args.pinned_only, args.limit));
    registerTool("pin_lesson", async (args: any) => {
        await pinLesson(args.lesson_id);
        return { pinned: args.lesson_id };
    });
    registerTool("unpin_lesson", async (args: any) => {
        await unpinLesson(args.lesson_id);
        return { unpinned: args.lesson_id };
    });
    registerTool("add_pool_note", async (args: any) => {
        addPoolNote(args.pool_address, args.note, args.agent_type || "");
        return { pool: args.pool_address, note: args.note };
    });
    registerTool("get_pool_memory", async (args: any) => {
        const notes = getPoolNotes(args.pool_address, args.limit || 20);
        return { pool: args.pool_address, notes };
    });
    registerTool("get_performance_history", async (args: any) => {
        const trades = getRecentTrades(args.days ? args.days * 10 : 50);
        const fees = getTotalFeesClaimed();
        return { trades, fees };
    });

    // Strategy Library — SQLite-backed
    registerTool("add_strategy", async (args: any) => {
        const { addStrategy } = await import("../memory/strategies");
        addStrategy({
            name: args.name,
            type: args.type || "custom_ratio_spot",
            description: args.description || "",
            binRangeRules: args.bin_range_rules || {},
            directionalSplit: args.directional_split || {},
            ratioRules: args.ratio_rules || {},
            managementRules: args.management_rules || {},
            active: false,
        });
        return { added: args.name };
    });
    registerTool("list_strategies", async () => {
        const { listStrategies } = await import("../memory/strategies");
        const strategies = listStrategies();
        return { strategies };
    });
    registerTool("get_strategy", async (args: any) => {
        const { getStrategy } = await import("../memory/strategies");
        const strategy = getStrategy(args.name);
        return strategy || { error: "Strategy not found", name: args.name };
    });
    registerTool("set_active_strategy", async (args: any) => {
        const { setActiveStrategy } = await import("../memory/strategies");
        setActiveStrategy(args.name);
        return { active: args.name };
    });
    registerTool("remove_strategy", async (args: any) => {
        const { removeStrategy } = await import("../memory/strategies");
        const removed = removeStrategy(args.name);
        return { removed: removed ? args.name : null };
    });

    // Blacklist — SQLite-backed
    registerTool("add_to_blacklist", async (args: any) => {
        const { addToBlacklist } = await import("../memory/blacklist");
        addToBlacklist(args.token, args.reason || "");
        return { blacklisted: args.token };
    });
    registerTool("remove_from_blacklist", async (args: any) => {
        const { removeFromBlacklist } = await import("../memory/blacklist");
        const removed = removeFromBlacklist(args.token);
        return { removed: removed ? args.token : null };
    });
    registerTool("list_blacklist", async () => {
        const { listBlacklist } = await import("../memory/blacklist");
        const tokens = listBlacklist();
        return { tokens };
    });

    // Strategy Compute
    registerTool("compute_strategy", async (args: any) => {
        const { computeStrategy } = await import("../tools/strategies");
        const result = computeStrategy(args.strategy_type, {
            pool: {
                address: args.pool_address,
                volatility: args.volatility ?? 0,
                priceTrend: args.price_trend ?? "flat",
            } as any,
            market: {
                priceChange1hPct: args.price_change_1h_pct ?? 0,
                priceChange24hPct: args.price_change_24h_pct ?? 0,
                netBuyers1h: args.net_buyers_1h ?? 0,
                netBuyers24h: args.net_buyers_24h ?? 0,
                volatility: args.volatility ?? 0,
                priceTrend: args.price_trend ?? "flat",
            },
            walletSolBalance: args.wallet_sol_balance ?? 0,
            maxDeploySol: args.max_deploy_sol ?? config.risk.maxDeployAmount,
            gasReserve: args.gas_reserve ?? config.management.gasReserve,
        });
        return result;
    });

    // Self-management — with 5-layer guardrails
    registerTool("update_config", async (args: any) => {
        const { applyGuardedConfigChange } = await import("../core/config-guard");
        const result = applyGuardedConfigChange({
            key: args.key,
            newValue: args.value,
            reason: args.reason,
            proposedBy: args.role || "EVOLVER",
        });

        if (result.applied) {
            logger.info({
                key: result.key,
                oldValue: result.oldValue,
                newValue: result.newValue,
                reason: result.reason,
            }, "Config change applied via guardrails");
        } else {
            logger.warn({
                key: result.key,
                rejection: result.rejectionReason,
            }, "Config change rejected by guardrails");
        }

        return result;
    });

    // Computed Metrics — for EVOLVER data-driven analysis
    registerTool("get_computed_metrics", async (args: any) => {
        const { getAllComputedMetrics } = await import("../memory/metrics");
        return getAllComputedMetrics(args.days || 30);
    });

    // Config Change Audit Trail
    registerTool("get_config_history", async (args: any) => {
        const { getRecentConfigChanges } = await import("../core/config-guard");
        return getRecentConfigChanges(args.limit || 20);
    });

    // DexScreener
    registerTool("dex_screener_token_pairs", async (args: any) => {
        const { getTokenPairs, extractMarketData } = await import("../chain/dexscreener");
        const pairs = await getTokenPairs(args.token_address, args.chain || "solana");
        return pairs.map(p => extractMarketData(p));
    });
    registerTool("dex_screener_boosted_tokens", async () => {
        const { getBoostedTokens } = await import("../chain/dexscreener");
        return getBoostedTokens();
    });
    registerTool("pre_screen_token", async (args: any) => {
        const { preScreenToken } = await import("../strategy/pre-screen");
        return preScreenToken(args.token_address, config.dexScreener.preScreen);
    });

    logger.info("All tools registered");
}
