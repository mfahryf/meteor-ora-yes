// src/strategy/risk.ts
import type { Config } from "../config/schema";
import { getOpenPositions } from "../memory/positions";

export function isUnderPositionLimit(config: Config): boolean {
    return getOpenPositions().length < config.risk.maxPositions;
}

export function isSafeToDeploy(
    balance: number,
    deployAmount: number,
    gasReserve: number
): boolean {
    return balance >= deployAmount + gasReserve;
}

export function isWithinBinStepRange(binStep: number, min: number, max: number): boolean {
    return binStep >= min && binStep <= max;
}

export function isNotDuplicatePool(poolAddress: string, existingPositions: Array<{ pool_address: string }>): boolean {
    return !existingPositions.some(p => p.pool_address === poolAddress);
}

export function isNotDuplicateToken(tokenMint: string, positions: Array<{ pool_address: string }>): boolean {
    // Check if any position already has this token
    return !positions.some(p => p.pool_address.includes(tokenMint));
}

export function passesGlobalFeesGate(globalFeesSol: number, minTokenFeesSol: number): boolean {
    return globalFeesSol >= minTokenFeesSol;
}
