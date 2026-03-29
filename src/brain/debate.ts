// src/brain/debate.ts
// Bull/Bear debate pattern — 3 sequential LLM calls to reduce confirmation bias
// Bull argues FOR, Bear argues AGAINST, Arbiter makes final decision

import { BULL_PROMPT } from "./prompts/bull";
import { BEAR_PROMPT } from "./prompts/bear";
import { ARBITER_PROMPT } from "./prompts/arbiter";
import type { PoolCandidate } from "../strategy/types";
import type { Config } from "../config/schema";
import { logger } from "../utils/logger";

// ─── Types ─────────────────────────────────────────────────────────

export interface DebateResult {
    bullScore: number;
    bullReasoning: string;
    bullFactors: string[];
    bearScore: number;
    bearReasoning: string;
    bearFlags: string[];
    arbiterScore: number;
    arbiterReasoning: string;
    recommendation: "deploy" | "skip";
    debateDurationMs: number;
}

// ─── LLM Call Helper ───────────────────────────────────────────────

async function llmCall(
    systemPrompt: string,
    userMessage: string,
    config: Config,
): Promise<string> {
    const model = config.llm.screeningModel || config.llm.model;
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt + "\n\nIMPORTANT: Respond ONLY with a JSON object, no markdown, no explanation." },
                { role: "user", content: userMessage },
            ],
            temperature: config.llm.temperature || 0.3,
            max_tokens: 500,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`LLM call failed: ${response.status} ${response.statusText} — ${errorBody.substring(0, 200)}`);
    }

    const json = await response.json() as any;
    return json.choices?.[0]?.message?.content || "{}";
}

// ─── Build Data Summary for Debate ─────────────────────────────────

function buildCandidateDataSummary(candidate: PoolCandidate): string {
    const lines: string[] = [
        `## Pool: ${candidate.tokenASymbol}/${candidate.tokenBSymbol}`,
        `- Address: ${candidate.address}`,
        `- TVL: $${candidate.tvl.toLocaleString()}`,
        `- Volume 24h: $${candidate.volume24h.toLocaleString()}`,
        `- Fees 24h: $${candidate.fees24h.toLocaleString()}`,
        `- Fee APR: ${(candidate.feeApr * 100).toFixed(1)}%`,
        `- Bin Step: ${candidate.binStep}`,
        `- Volatility: ${candidate.volatility.toFixed(2)}`,
        `- Price Trend: ${candidate.priceTrend}`,
        `- Net Buyers 24h: ${candidate.netBuyers}`,
        `- Pool Age: ${candidate.poolAgeDays.toFixed(1)} days`,
        `- Pre-screen Score: ${candidate.score}`,
    ];

    if (candidate.dexScreener) {
        const ds = candidate.dexScreener;
        lines.push(
            ``,
            `### DexScreener Data:`,
            `- Price Change 5m: ${ds.priceChange5m.toFixed(1)}%`,
            `- Price Change 1h: ${ds.priceChange1h.toFixed(1)}%`,
            `- Price Change 24h: ${ds.priceChange24h.toFixed(1)}%`,
            `- Buys 24h: ${ds.buys24h}`,
            `- Sells 24h: ${ds.sells24h}`,
            `- Buy/Sell Ratio: ${ds.buySellRatio24h.toFixed(2)}`,
            `- Liquidity USD: $${ds.liquidityUsd.toLocaleString()}`,
            `- FDV: $${ds.fdv.toLocaleString()}`,
            `- Market Cap: $${ds.marketCap.toLocaleString()}`,
            `- Pair Age: ${ds.pairAgeHours.toFixed(1)} hours`,
            `- Boosted: ${ds.isBoosted ? `Yes (${ds.boostAmount})` : "No"}`,
        );
    }

    return lines.join("\n");
}

// ─── Parse LLM JSON Response ───────────────────────────────────────

function safeParseJSON(raw: string, defaults: Record<string, any>): any {
    try {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
        return JSON.parse(jsonMatch[1] || raw);
    } catch {
        logger.warn({ raw: raw.substring(0, 200) }, "Failed to parse debate LLM response");
        return defaults;
    }
}

// ─── Main Debate Function ──────────────────────────────────────────

export async function runBullBearDebate(
    candidate: PoolCandidate,
    config: Config,
): Promise<DebateResult> {
    const startTime = Date.now();
    const dataSummary = buildCandidateDataSummary(candidate);

    logger.info({
        pool: candidate.address,
        token: `${candidate.tokenASymbol}/${candidate.tokenBSymbol}`,
    }, "Starting Bull/Bear debate");

    // Step 1: Bull makes the case FOR
    let bullResult: any;
    try {
        const bullRaw = await llmCall(BULL_PROMPT, dataSummary, config);
        bullResult = safeParseJSON(bullRaw, { score: 50, reasoning: "Unable to analyze", key_factors: [] });
    } catch (error) {
        logger.warn({ error: String(error) }, "Bull LLM call failed");
        bullResult = { score: 50, reasoning: "Bull analysis unavailable", key_factors: [] };
    }

    // Step 2: Bear makes the case AGAINST
    let bearResult: any;
    try {
        const bearRaw = await llmCall(BEAR_PROMPT, dataSummary, config);
        bearResult = safeParseJSON(bearRaw, { score: 50, reasoning: "Unable to analyze", red_flags: [] });
    } catch (error) {
        logger.warn({ error: String(error) }, "Bear LLM call failed");
        bearResult = { score: 50, reasoning: "Bear analysis unavailable", red_flags: [] };
    }

    // Step 3: Arbiter weighs both sides
    const arbiterInput = [
        dataSummary,
        "",
        "---",
        "",
        "## BULL CASE:",
        `Score: ${bullResult.score}/100`,
        `Reasoning: ${bullResult.reasoning}`,
        `Key Factors: ${(bullResult.key_factors || []).join(", ")}`,
        "",
        "## BEAR CASE:",
        `Score: ${bearResult.score}/100 (higher = more dangerous)`,
        `Reasoning: ${bearResult.reasoning}`,
        `Red Flags: ${(bearResult.red_flags || []).join(", ")}`,
    ].join("\n");

    let arbiterResult: any;
    try {
        const arbiterRaw = await llmCall(ARBITER_PROMPT, arbiterInput, config);
        arbiterResult = safeParseJSON(arbiterRaw, { score: 50, recommendation: "skip", reasoning: "Unable to decide" });
    } catch (error) {
        logger.warn({ error: String(error) }, "Arbiter LLM call failed");
        arbiterResult = { score: 40, recommendation: "skip", reasoning: "Arbiter unavailable — defaulting to skip for safety" };
    }

    const threshold = config.screening.debateScoreThreshold ?? 60;
    const recommendation = (arbiterResult.score >= threshold) ? "deploy" : "skip";

    const result: DebateResult = {
        bullScore: Number(bullResult.score) || 50,
        bullReasoning: String(bullResult.reasoning || ""),
        bullFactors: bullResult.key_factors || [],
        bearScore: Number(bearResult.score) || 50,
        bearReasoning: String(bearResult.reasoning || ""),
        bearFlags: bearResult.red_flags || [],
        arbiterScore: Number(arbiterResult.score) || 50,
        arbiterReasoning: String(arbiterResult.reasoning || ""),
        recommendation,
        debateDurationMs: Date.now() - startTime,
    };

    logger.info({
        pool: candidate.address,
        bullScore: result.bullScore,
        bearScore: result.bearScore,
        arbiterScore: result.arbiterScore,
        recommendation: result.recommendation,
        durationMs: result.debateDurationMs,
    }, `Debate result: ${result.recommendation.toUpperCase()}`);

    return result;
}
