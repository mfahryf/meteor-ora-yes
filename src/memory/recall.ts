// src/memory/recall.ts
// Merges SQLite + Qdrant data into agent context for the ReAct loop

import { getOpenPositions } from "./positions";
import { getRecentTrades } from "./trades";
import { getTotalFeesClaimed } from "./fees";
import { listLessons, searchLessons } from "./lessons";
import { getActiveStrategy } from "./strategies";
import { logger } from "../utils/logger";

export interface AgentContext {
    wallet: {
        solBalance: number;
        tokenBalances: Record<string, number>;
    };
    positions: Array<{
        position_pubkey: string;
        pool_address: string;
        strategy_type: string;
        amount_x: number;
        amount_y: number;
        status: string;
    }>;
    performance: {
        totalTrades: number;
        totalFeesClaimedA: number;
        totalFeesClaimedB: number;
    };
    lessons: Array<{
        id: string;
        text: string;
        role: string;
        pinned: boolean;
    }>;
    recentActivity: Array<{
        action: string;
        pool_address: string;
        amount_sol: number;
        timestamp: string;
    }>;
    activeStrategy?: {
        name: string;
        type: string;
        managementRules: Record<string, unknown>;
    };
}

export async function buildContext(
    role: string,
    walletSolBalance: number = 0,
    walletTokenBalances: Record<string, number> = {},
    lessonVector?: number[]
): Promise<AgentContext> {
    // SQLite queries (synchronous with bun:sqlite)
    const openPositions = getOpenPositions();
    const recentTrades = getRecentTrades(10);
    const fees = getTotalFeesClaimed();

    // Qdrant queries (async)
    let lessons: any[] = [];
    try {
        const pinned = await listLessons(role, true, 5);
        if (lessonVector) {
            const relevant = await searchLessons(lessonVector, role, 5);
            lessons = [...pinned, ...relevant.filter((r: any) => !pinned.some((p: any) => p.id === r.id))];
        } else {
            const recent = await listLessons(role, false, 5);
            lessons = [...pinned, ...recent.filter((r: any) => !pinned.some((p: any) => p.id === r.id))];
        }
    } catch (error) {
        logger.warn({ error }, "Failed to fetch lessons from Qdrant, continuing without");
    }

    return {
        wallet: {
            solBalance: walletSolBalance,
            tokenBalances: walletTokenBalances,
        },
        positions: openPositions.map(p => ({
            position_pubkey: p.position_pubkey,
            pool_address: p.pool_address,
            strategy_type: p.strategy_type,
            amount_x: p.amount_x,
            amount_y: p.amount_y,
            status: p.status,
        })),
        performance: {
            totalTrades: recentTrades.length,
            totalFeesClaimedA: fees.totalFeeA,
            totalFeesClaimedB: fees.totalFeeB,
        },
        lessons: lessons.map((l: any) => ({
            id: l.id,
            text: l.text,
            role: l.role,
            pinned: l.pinned,
        })),
        recentActivity: recentTrades.map(t => ({
            action: t.action,
            pool_address: t.pool_address,
            amount_sol: t.amount_sol,
            timestamp: t.timestamp || "",
        })),
        activeStrategy: (() => {
            const s = getActiveStrategy();
            if (!s) return undefined;
            return {
                name: s.name,
                type: s.type,
                managementRules: s.managementRules,
            };
        })(),
    };
}

export function contextToPromptString(ctx: AgentContext): string {
    const lines: string[] = [];

    lines.push("Portfolio:");
    lines.push(`  SOL Balance: ${ctx.wallet.solBalance.toFixed(4)} SOL`);
    for (const [token, amount] of Object.entries(ctx.wallet.tokenBalances)) {
        lines.push(`  ${token}: ${amount}`);
    }

    if (ctx.positions.length > 0) {
        lines.push("\nOpen Positions:");
        for (const pos of ctx.positions) {
            lines.push(`  - ${pos.position_pubkey} | ${pos.pool_address} | ${pos.strategy_type} | X:${pos.amount_x} Y:${pos.amount_y} | ${pos.status}`);
        }
    } else {
        lines.push("\nOpen Positions: None");
    }

    lines.push("\nPerformance:");
    lines.push(`  Recent trades: ${ctx.performance.totalTrades}`);
    lines.push(`  Total fees claimed: ${ctx.performance.totalFeesClaimedA} A, ${ctx.performance.totalFeesClaimedB} B`);

    if (ctx.lessons.length > 0) {
        lines.push("\nLessons:");
        for (const lesson of ctx.lessons) {
            const pin = lesson.pinned ? "[PINNED] " : "";
            lines.push(`  - ${pin}(${lesson.role}) ${lesson.text}`);
        }
    }

    if (ctx.activeStrategy) {
        lines.push("\nActive Strategy:");
        lines.push(`  Name: ${ctx.activeStrategy.name}`);
        lines.push(`  Type: ${ctx.activeStrategy.type}`);
        lines.push(`  Rules: ${JSON.stringify(ctx.activeStrategy.managementRules)}`);
    }

    if (ctx.recentActivity.length > 0) {
        lines.push("\nRecent Activity:");
        for (const act of ctx.recentActivity.slice(0, 5)) {
            lines.push(`  - ${act.action} on ${act.pool_address} | ${act.amount_sol} SOL | ${act.timestamp}`);
        }
    }

    return lines.join("\n");
}
