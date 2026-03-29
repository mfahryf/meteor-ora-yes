// src/strategy/types.ts

export type StrategyType =
    | "custom_ratio_spot"
    | "bid_ask"
    | "single_sided_reseed"
    | "fee_compounding"
    | "partial_harvest"
    | "multi_layer";

export type ActionType =
    | "deploy"
    | "close"
    | "add_liquidity"
    | "withdraw_liquidity"
    | "claim_fees"
    | "swap"
    | "rebalance"
    | "hold";

export interface StrategyProfile {
    name: string;
    type: StrategyType;
    description: string;
    binRangeRules: {
        lowVolBins: [number, number];
        medVolBins: [number, number];
        highVolBins: [number, number];
        extremeVolBins: [number, number];
    };
    directionalSplit: {
        downtrend: number; // bins_below ratio
        uptrend: number;
        flat: number;
    };
    ratioRules: {
        strongBull: [number, number]; // [token%, sol%]
        bull: [number, number];
        neutral: [number, number];
        bear: [number, number];
        strongBear: [number, number];
    };
    managementRules: {
        feeCompounding: boolean;
        singleSidedReseed: boolean;
        partialHarvestThreshold: number; // percentage
    };
    active: boolean;
}

export interface PoolCandidate {
    address: string;
    tokenAMint: string;
    tokenBMint: string;
    tokenASymbol: string;
    tokenBSymbol: string;
    binStep: number;
    tvl: number;
    volume24h: number;
    fees24h: number;
    feeApr: number;
    feeActiveTvlRatio: number;
    volatility: number;
    priceTrend: "up" | "down" | "flat";
    netBuyers: number;
    poolAgeDays: number;
    score: number;

    // DexScreener-enriched fields (optional, populated by pre-screen)
    dexScreener?: {
        priceChange5m: number;
        priceChange1h: number;
        priceChange6h: number;
        priceChange24h: number;
        buys24h: number;
        sells24h: number;
        buySellRatio24h: number;
        liquidityUsd: number;
        fdv: number;
        marketCap: number;
        pairAgeHours: number;
        isBoosted: boolean;
        boostAmount: number;
        preScreenScore: number;
    };
}

export interface DeployParams {
    poolAddress: string;
    binStep: number;
    minBin: number;
    maxBin: number;
    totalBins: number;
    binsBelow: number;
    binsAbove: number;
    amountSol: number;
    strategyType: StrategyType;
    tokenRatio: number; // 0-1, percentage of capital in token
    solRatio: number;   // 0-1, percentage of capital in SOL
}
