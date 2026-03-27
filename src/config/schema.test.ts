// src/config/schema.test.ts
import { expect, test } from "bun:test";
import { ConfigSchema } from "./schema";

test("validates minimal valid config", () => {
  const rawConfig = {
    preset: "custom",
    credentials: {
      rpcUrl: "https://rpc.example.com",
      walletKey: "secret",
      heliusApiKey: "key",
      telegramBotToken: "token",
      telegramChatId: "id"
    },
    llm: {
      baseUrl: "https://api.openai.com",
      apiKey: "key",
      model: "gpt-4",
      managementModel: "gpt-4",
      screeningModel: "gpt-4",
      generalModel: "gpt-4",
      chatModel: "gpt-4",
      temperature: 0.3,
      maxTokens: 1000,
      maxSteps: 10
    },
    risk: { maxPositions: 3, maxDeployAmount: 0.5 },
    screening: {
      timeframe: "30m", category: "trending", minTvl: 10000, maxTvl: 100000,
      minVolume: 1000, minOrganic: 50, minHolders: 100, minMcap: 50000,
      maxMcap: 1000000, minBinStep: 80, maxBinStep: 125, minFeeActiveTvlRatio: 0.01,
      minTokenFeesSol: 10, maxBundlersPct: 20, maxTop10Pct: 50, blockedLaunchpads: []
    },
    management: {
      strategy: "bid_ask", binsBelow: 20, binsAbove: 20, deployAmountSol: 0.1,
      minSolToOpen: 0.1, gasReserve: 0.05, positionSizePct: 100, takeProfitFeePct: 5,
      emergencyPriceDropPct: -30, outOfRangeWaitMinutes: 20, outOfRangeBinsToClose: 10,
      minClaimAmount: 0.1, minVolumeToRebalance: 1000, minFeePerTvl24h: 0.05,
      autoSwapAfterClaim: true
    },
    telegram: {
      authorizedChatIds: ["id"], chatHistoryLimit: 20, approvalTimeoutMs: 300000,
      rateLimitPerSecond: 0.5, rateLimitPerHour: 100
    },
    schedule: {
      managementIntervalMin: 5, screeningIntervalMin: 30,
      evolutionIntervalHours: 6, healthCheckIntervalMin: 60
    },
    runtime: { dryRun: true, logLevel: "info" }
  };

  const result = ConfigSchema.safeParse(rawConfig);
  expect(result.success).toBe(true);
});
