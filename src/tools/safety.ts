// src/tools/safety.ts
// Multi-layer pre-flight safety checks for all WRITE tools

import { getOpenPositions } from "../memory/positions";
import { isBlacklisted } from "../memory/blacklist";
import { logger } from "../utils/logger";
import type { Config } from "../config/schema";

export interface SafetyResult {
    blocked: boolean;
    reason?: string;
}

const WRITE_TOOLS = new Set([
    "deploy_position",
    "close_position",
    "swap_token",
    "claim_fees",
    "add_liquidity",
    "withdraw_liquidity",
]);

export async function runSafetyChecks(
    toolName: string,
    args: any,
    config: Config,
    walletSolBalance: number
): Promise<SafetyResult> {
    if (!WRITE_TOOLS.has(toolName)) return { blocked: false };

    switch (toolName) {
        case "deploy_position":
            return checkDeploy(args, config, walletSolBalance);
        case "swap_token":
            return checkSwap(args, config);
        case "close_position":
        case "claim_fees":
        case "withdraw_liquidity":
            return checkPositionAction(args);
        case "add_liquidity":
            return checkAddLiquidity(args, config, walletSolBalance);
        default:
            return { blocked: false };
    }
}

// ─── deploy_position checks ──────────────────────────────────────

async function checkDeploy(args: any, config: Config, balance: number): Promise<SafetyResult> {
    // 1. Config limits
    if (args.bin_step < config.screening.minBinStep || args.bin_step > config.screening.maxBinStep) {
        return blocked(`Bin step ${args.bin_step} outside allowed range [${config.screening.minBinStep}-${config.screening.maxBinStep}]`);
    }

    // 2. Max positions
    const positions = getOpenPositions();
    if (positions.length >= config.risk.maxPositions) {
        return blocked(`Max positions (${config.risk.maxPositions}) reached`);
    }

    // 3. Max deploy amount
    if (args.amount_sol > config.risk.maxDeployAmount) {
        return blocked(`Deploy amount ${args.amount_sol} exceeds max ${config.risk.maxDeployAmount}`);
    }

    // 4. Blocked launchpad
    if (args.launchpad && config.screening.blockedLaunchpads?.includes(args.launchpad)) {
        return blocked(`Launchpad ${args.launchpad} is blocked`);
    }

    // 5. Duplicate pool — force fresh scan, no cache
    const samePoolPositions = positions.filter(p => p.pool_address === args.pool_address);
    if (samePoolPositions.length > 0 && !args.allow_duplicate_pool) {
        return blocked(`Position already exists in pool ${args.pool_address}`);
    }

    // 6. Duplicate base mint (prevent over-concentration)
    if (args.base_mint && !args.allow_duplicate_pool) {
        const sameBase = positions.filter(p => p.pool_address !== args.pool_address);
        // This check is informational — same token across different pools is allowed
        // but we log it for awareness
        if (sameBase.length > 0) {
            logger.info({ baseMint: args.base_mint, existingPools: sameBase.map(p => p.pool_address) }, "Same base mint exists in other pools");
        }
    }

    // 7. Blacklisted token
    if (args.base_mint && isBlacklisted(args.base_mint)) {
        return blocked(`Token ${args.base_mint} is blacklisted`);
    }

    // 8. Balance check (skip for token-only deploys)
    const needsSol = !args.amount_token_only;
    if (needsSol) {
        const amountNeeded = args.amount_sol + config.management.gasReserve;
        if (balance < amountNeeded) {
            return blocked(`Insufficient balance: ${balance.toFixed(4)} SOL < ${amountNeeded.toFixed(4)} SOL needed`);
        }
    }

    // 9. Floor/ceiling enforcement
    if (args.amount_sol < config.management.minSolToOpen) {
        return blocked(`Deploy amount ${args.amount_sol} below minimum ${config.management.minSolToOpen}`);
    }

    logger.info({ pool: args.pool_address, amount: args.amount_sol }, "Safety checks passed");
    return { blocked: false };
}

// ─── swap_token checks ───────────────────────────────────────────

function checkSwap(args: any, config: Config): SafetyResult {
    if (!args.input_mint || !args.output_mint) {
        return blocked("Missing input_mint or output_mint");
    }
    if (!args.amount || args.amount <= 0) {
        return blocked("Swap amount must be positive");
    }
    if (isBlacklisted(args.input_mint) || isBlacklisted(args.output_mint)) {
        return blocked("Token is blacklisted");
    }
    return { blocked: false };
}

// ─── close/claim/withdraw checks ──────────────────────────────────

function checkPositionAction(args: any): SafetyResult {
    if (!args.position_pubkey) {
        return blocked("Missing position_pubkey");
    }
    if (!args.pool_address) {
        return blocked("Missing pool_address");
    }
    return { blocked: false };
}

// ─── add_liquidity checks ─────────────────────────────────────────

function checkAddLiquidity(args: any, config: Config, balance: number): SafetyResult {
    if (!args.position_pubkey || !args.pool_address) {
        return blocked("Missing position_pubkey or pool_address");
    }
    if (args.amount_sol) {
        const needed = args.amount_sol + config.management.gasReserve;
        if (balance < needed) {
            return blocked(`Insufficient balance: ${balance.toFixed(4)} SOL < ${needed.toFixed(4)} SOL needed`);
        }
    }
    return { blocked: false };
}

// ─── helpers ──────────────────────────────────────────────────────

function blocked(reason: string): SafetyResult {
    logger.warn({ reason }, "Safety check blocked");
    return { blocked: true, reason };
}
