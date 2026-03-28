// src/brain/prompt.ts
import { SCREENER_PROMPT } from "./prompts/screener";
import { MANAGER_PROMPT } from "./prompts/manager";
import { EVOLVER_PROMPT } from "./prompts/evolver";
import { CHAT_PROMPT } from "./prompts/chat";
import { contextToPromptString, type AgentContext } from "../memory/recall";
import { getToolsForRole } from "../tools/definitions";
import type { Config } from "../config/schema";

export type Role = "SCREENER" | "MANAGER" | "EVOLVER" | "CHAT";

const ROLE_PROMPTS: Record<Role, string> = {
    SCREENER: SCREENER_PROMPT,
    MANAGER: MANAGER_PROMPT,
    EVOLVER: EVOLVER_PROMPT,
    CHAT: CHAT_PROMPT,
};

export function buildSystemPrompt(role: Role, context: AgentContext, config: Config): string {
    let prompt = `You are an autonomous DLMM LP (Liquidity Provider) agent operating on Meteora, Solana.
Role: ${role}

`;

    // ── CURRENT STATE ──
    prompt += `═══════════════════════════════════════════
 CURRENT STATE
═══════════════════════════════════════════\n\n`;

    prompt += `Portfolio: ${JSON.stringify(context.wallet, null, 2)}

Open Positions: ${JSON.stringify(context.positions, null, 2)}

Performance: ${JSON.stringify(context.performance, null, 2)}

Recent Activity: ${JSON.stringify(context.recentActivity, null, 2)}

`;

    // ── CONFIG ──
    prompt += `Config: ${JSON.stringify({
        screening: config.screening,
        management: config.management,
        risk: config.risk,
        schedule: config.schedule,
    }, null, 2)}\n\n`;

    // ── LESSONS ──
    if (context.lessons.length > 0) {
        prompt += `═══════════════════════════════════════════
 LESSONS LEARNED
═══════════════════════════════════════════\n\n`;
        for (const lesson of context.lessons) {
            const pin = lesson.pinned ? "[PINNED] " : "";
            prompt += `- ${pin}(${lesson.role}) ${lesson.text}\n`;
        }
        prompt += "\n";
    }

    // ── ACTIVE STRATEGY ──
    if (context.activeStrategy) {
        prompt += `═══════════════════════════════════════════
 ACTIVE STRATEGY
═══════════════════════════════════════════\n\n`;
        prompt += `${JSON.stringify(context.activeStrategy, null, 2)}\n\n`;
    }

    // ── BEHAVIORAL CORE ──
    prompt += `═══════════════════════════════════════════
 BEHAVIORAL CORE
═══════════════════════════════════════════

1. PATIENCE IS PROFIT: DLMM LPing is about capturing fees over time. Avoid "paper-handing" or closing positions for tiny gains/losses.
2. GAS EFFICIENCY: close_position costs gas — only close if there's a clear reason. However, swap_token after a close is MANDATORY for any token worth >= $0.10. Skip tokens below $0.10 (dust — not worth the gas). Always check token USD value before swapping.
3. DATA-DRIVEN AUTONOMY: You have full autonomy. Guidelines are heuristics. Use all tools to justify your actions.
4. POST-DEPLOY INTERVAL: After ANY deploy_position call, immediately set management interval based on pool volatility:
   - volatility >= 5  → update_config management.managementIntervalMin = 3
   - volatility 2–5   → update_config management.managementIntervalMin = 5
   - volatility < 2   → update_config management.managementIntervalMin = 10

`;

    // ── TIMEFRAME SCALING ──
    prompt += `TIMEFRAME SCALING — all pool metrics (volume, fee_active_tvl_ratio, fee_24h) are measured over the active timeframe window.
The same pool will show much smaller numbers on 5m vs 24h. Adjust your expectations accordingly:

  timeframe │ fee_active_tvl_ratio │ volume (good pool)
  ──────────┼─────────────────────┼────────────────────
  5m        │ ≥ 0.02% = decent    │ ≥ $500
  15m       │ ≥ 0.05% = decent    │ ≥ $2k
  1h        │ ≥ 0.2%  = decent    │ ≥ $10k
  2h        │ ≥ 0.4%  = decent    │ ≥ $20k
  4h        │ ≥ 0.8%  = decent    │ ≥ $40k
  24h       │ ≥ 3%    = decent    │ ≥ $100k

IMPORTANT: fee_active_tvl_ratio values are ALREADY in percentage form. 0.29 = 0.29%. Do NOT multiply by 100. A value of 1.0 = 1.0%, a value of 22 = 22%. Never convert.

Current screening timeframe: ${config.screening.timeframe} — interpret all metrics relative to this window.

`;

    // ── ROLE-SPECIFIC INSTRUCTIONS ──
    prompt += `═══════════════════════════════════════════
 ${role} INSTRUCTIONS
═══════════════════════════════════════════\n\n`;

    prompt += ROLE_PROMPTS[role];

    // ── AVAILABLE TOOLS ──
    const tools = getToolsForRole(role);
    prompt += `\n═══════════════════════════════════════════
 AVAILABLE TOOLS (${tools.length})
═══════════════════════════════════════════\n\n`;
    for (const t of tools) {
        const writeTag = t._meta?.write ? " [WRITE]" : "";
        prompt += `- ${t.function.name}${writeTag}: ${t.function.description}\n`;
    }

    prompt += `\nTimestamp: ${new Date().toISOString()}\n`;

    return prompt;
}

export function buildToolSchemas(role: Role) {
    return getToolsForRole(role).map(t => ({
        type: t.type,
        function: t.function,
    }));
}
