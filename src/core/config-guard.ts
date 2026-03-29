// src/core/config-guard.ts
// Strict guardrails for auto-applying config changes — 5 safety layers
// No human approval needed, but changes MUST be data-backed, bounded, and incremental.

import { getDb } from "../memory/sqlite";
import { logger } from "../utils/logger";

// ─── Layer 1: Hard Bounds ──────────────────────────────────────────

const CONFIG_BOUNDS: Record<string, { min: number; max: number }> = {
    "risk.maxPositions":                { min: 1,     max: 10     },
    "risk.maxDeployAmount":             { min: 0.01,  max: 2.0    },
    "screening.minTvl":                 { min: 1000,  max: 500000 },
    "screening.maxTvl":                 { min: 10000, max: 5000000 },
    "screening.minVolume":              { min: 100,   max: 100000 },
    "screening.minBinStep":             { min: 1,     max: 100    },
    "screening.maxBinStep":             { min: 10,    max: 200    },
    "screening.minFeeActiveTvlRatio":   { min: 0.001, max: 1.0    },
    "screening.minTokenFeesSol":        { min: 0.001, max: 100    },
    "screening.maxBundlersPct":         { min: 5,     max: 80     },
    "screening.maxTop10Pct":            { min: 10,    max: 90     },
    "management.deployAmountSol":       { min: 0.01,  max: 2.0    },
    "management.gasReserve":            { min: 0.02,  max: 0.5    },
    "management.emergencyPriceDropPct": { min: -80,   max: -5     },
    "management.takeProfitFeePct":      { min: 1,     max: 50     },
    "management.outOfRangeWaitMinutes": { min: 5,     max: 120    },
    "management.minClaimAmount":        { min: 0.001, max: 1.0    },
    "dexScreener.preScreen.minLiquidityUsd": { min: 500,  max: 100000 },
    "dexScreener.preScreen.minTxns24h":      { min: 10,   max: 1000   },
    "dexScreener.preScreen.minPairAgeHours": { min: 0,    max: 168    },
};

// ─── Layer 2: Max Step Size ────────────────────────────────────────

const MAX_CHANGE_PCT = 0.20; // 20% max change per cycle

function isWithinStepLimit(oldVal: number, newVal: number): boolean {
    if (oldVal === 0) return Math.abs(newVal) < 1; // edge case
    const changePct = Math.abs(newVal - oldVal) / Math.abs(oldVal);
    return changePct <= MAX_CHANGE_PCT;
}

// ─── Layer 3: Cooldown ─────────────────────────────────────────────

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function getLastChangeTime(key: string): number | null {
    try {
        const db = getDb();
        const row = db.prepare(
            `SELECT timestamp FROM config_change_log WHERE key = $key ORDER BY timestamp DESC LIMIT 1`
        ).get({ $key: key }) as any;
        return row ? new Date(row.timestamp).getTime() : null;
    } catch {
        return null;
    }
}

function isOffCooldown(key: string): boolean {
    const lastChange = getLastChangeTime(key);
    return !lastChange || (Date.now() - lastChange) > COOLDOWN_MS;
}

// ─── Layer 4: Reasoning Validation ─────────────────────────────────

function hasValidReasoning(reason: string): boolean {
    if (!reason || reason.length < 20) return false;
    // Must contain numbers (data-backed)
    const hasNumbers = /\d+/.test(reason);
    // Must contain comparison/context words
    const hasComparison = /(because|since|from|to|was|rate|pct|%|average|ratio|win|loss|rug|profit|trades|positions|pools)/i.test(reason);
    return hasNumbers && hasComparison;
}

// ─── Layer 5: Audit Trail & Logging ────────────────────────────────

export interface ConfigChangeLog {
    id?: number;
    key: string;
    oldValue: string;
    newValue: string;
    reason: string;
    proposedBy: string;
    appliedAt: string;
    guardChecks: {
        withinBounds: boolean;
        withinStepLimit: boolean;
        offCooldown: boolean;
        hasValidReasoning: boolean;
    };
    applied: boolean;
    rejectionReason?: string;
}

function logConfigChange(entry: ConfigChangeLog): void {
    try {
        const db = getDb();
        db.prepare(`
            INSERT INTO config_change_log (key, old_value, new_value, reason, proposed_by, guard_checks, applied, rejection_reason)
            VALUES ($key, $oldValue, $newValue, $reason, $proposedBy, $guardChecks, $applied, $rejectionReason)
        `).run({
            $key: entry.key,
            $oldValue: entry.oldValue,
            $newValue: entry.newValue,
            $reason: entry.reason,
            $proposedBy: entry.proposedBy,
            $guardChecks: JSON.stringify(entry.guardChecks),
            $applied: entry.applied ? 1 : 0,
            $rejectionReason: entry.rejectionReason || null,
        });
    } catch (error) {
        logger.error({ error: String(error) }, "Failed to log config change");
    }
}

// ─── Config Read/Write Helpers ─────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from "node:fs";

function getConfigValue(key: string, configPath: string = "config.json"): any {
    try {
        if (!existsSync(configPath)) return undefined;
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        const parts = key.split(".");
        let current = config;
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    } catch {
        return undefined;
    }
}

function setConfigValue(key: string, value: any, configPath: string = "config.json"): boolean {
    try {
        let config: any = {};
        if (existsSync(configPath)) {
            config = JSON.parse(readFileSync(configPath, "utf-8"));
        }

        const parts = key.split(".");
        let current = config;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;

        writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        return true;
    } catch (error) {
        logger.error({ key, error: String(error) }, "Failed to write config");
        return false;
    }
}

// ─── Main: Guarded Config Change ───────────────────────────────────

export interface GuardedChangeInput {
    key: string;
    newValue: any;
    reason: string;
    proposedBy: string;
}

export interface GuardedChangeResult {
    applied: boolean;
    key: string;
    oldValue: any;
    newValue: any;
    reason: string;
    proposedBy: string;
    rejectionReason?: string;
    guardChecks: {
        withinBounds: boolean;
        withinStepLimit: boolean;
        offCooldown: boolean;
        hasValidReasoning: boolean;
    };
}

export function applyGuardedConfigChange(input: GuardedChangeInput): GuardedChangeResult {
    const { key, newValue, reason, proposedBy } = input;
    const oldValue = getConfigValue(key);
    const numericNew = typeof newValue === "string" ? parseFloat(newValue) : newValue;
    const numericOld = typeof oldValue === "number" ? oldValue : parseFloat(String(oldValue));

    // Run all 4 guard checks
    const bounds = CONFIG_BOUNDS[key];
    const isNumeric = !isNaN(numericNew) && !isNaN(numericOld);

    const guardChecks = {
        withinBounds: bounds
            ? (numericNew >= bounds.min && numericNew <= bounds.max)
            : true, // no bounds defined = allow
        withinStepLimit: isNumeric
            ? isWithinStepLimit(numericOld, numericNew)
            : true, // non-numeric = allow
        offCooldown: isOffCooldown(key),
        hasValidReasoning: hasValidReasoning(reason),
    };

    // Determine if all guards pass
    const allPassed = Object.values(guardChecks).every(Boolean);

    // Build rejection reason
    let rejectionReason: string | undefined;
    if (!allPassed) {
        const reasons: string[] = [];
        if (!guardChecks.withinBounds) {
            reasons.push(`value ${numericNew} outside bounds [${bounds?.min}, ${bounds?.max}]`);
        }
        if (!guardChecks.withinStepLimit) {
            const changePct = numericOld !== 0
                ? ((Math.abs(numericNew - numericOld) / Math.abs(numericOld)) * 100).toFixed(1)
                : "∞";
            reasons.push(`change ${changePct}% exceeds max 20% step`);
        }
        if (!guardChecks.offCooldown) {
            reasons.push(`key "${key}" on cooldown (1h between changes)`);
        }
        if (!guardChecks.hasValidReasoning) {
            reasons.push(`reason lacks data: must include numbers and comparison context`);
        }
        rejectionReason = reasons.join("; ");
    }

    // Apply if all guards passed
    if (allPassed) {
        const applied = setConfigValue(key, numericNew);
        if (!applied) {
            rejectionReason = "failed to write config file";
        }

        logger.info({
            key,
            oldValue: numericOld,
            newValue: numericNew,
            reason,
            proposedBy,
            guardChecks,
        }, applied ? "Config change APPLIED" : "Config change FAILED to write");

        const result: GuardedChangeResult = {
            applied,
            key,
            oldValue: numericOld,
            newValue: numericNew,
            reason,
            proposedBy,
            rejectionReason: applied ? undefined : rejectionReason,
            guardChecks,
        };

        logConfigChange({
            key,
            oldValue: String(numericOld),
            newValue: String(numericNew),
            reason,
            proposedBy,
            appliedAt: new Date().toISOString(),
            guardChecks,
            applied,
            rejectionReason: applied ? undefined : rejectionReason,
        });

        return result;
    }

    // Rejected
    logger.warn({
        key,
        oldValue: numericOld,
        newValue: numericNew,
        reason,
        proposedBy,
        rejectionReason,
        guardChecks,
    }, "Config change REJECTED by guard");

    logConfigChange({
        key,
        oldValue: String(numericOld),
        newValue: String(numericNew),
        reason,
        proposedBy,
        appliedAt: new Date().toISOString(),
        guardChecks,
        applied: false,
        rejectionReason,
    });

    return {
        applied: false,
        key,
        oldValue: numericOld,
        newValue: numericNew,
        reason,
        proposedBy,
        rejectionReason,
        guardChecks,
    };
}

// ─── Query audit trail ─────────────────────────────────────────────

export function getRecentConfigChanges(limit: number = 20): ConfigChangeLog[] {
    try {
        const db = getDb();
        return db.prepare(
            `SELECT * FROM config_change_log ORDER BY timestamp DESC LIMIT $limit`
        ).all({ $limit: limit }) as ConfigChangeLog[];
    } catch {
        return [];
    }
}
