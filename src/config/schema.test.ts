// src/config/schema.test.ts
import { expect, test } from "bun:test";
import { ConfigSchema } from "./schema";
import { loadConfig, saveConfig } from "./loader";
import { defaultConfig } from "./defaults";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const validConfig = {
  preset: "custom",
  credentials: {
    rpcUrl: "https://rpc.example.com",
    walletKey: "secret",
    heliusApiKey: "key",
    telegramBotToken: "token",
  },
  llm: {
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    apiKey: "key",
    model: "glm-5-turbo",
    managementModel: "glm-5-turbo",
    screeningModel: "glm-5-turbo",
    generalModel: "glm-5-turbo",
    chatModel: "glm-5-turbo",
    temperature: 0.3,
    maxTokens: 1000,
    maxSteps: 10,
  },
  risk: { maxPositions: 3, maxDeployAmount: 0.5 },
  screening: {
    timeframe: "30m",
    category: "trending",
    minTvl: 10000,
    maxTvl: 500000,
    minVolume: 1000,
    minOrganic: 50,
    minHolders: 100,
    minMcap: 50000,
    maxMcap: 5000000,
    minBinStep: 10,
    maxBinStep: 125,
    minFeeActiveTvlRatio: 0.01,
    minTokenFeesSol: 0.01,
    maxBundlersPct: 20,
    maxTop10Pct: 50,
    blockedLaunchpads: [],
  },
  management: {
    strategy: "bid_ask",
    binsBelow: 20,
    binsAbove: 20,
    deployAmountSol: 0.1,
    minSolToOpen: 0.1,
    gasReserve: 0.05,
    positionSizePct: 100,
    takeProfitFeePct: 5,
    emergencyPriceDropPct: -30,
    outOfRangeWaitMinutes: 20,
    outOfRangeBinsToClose: 10,
    minClaimAmount: 0.01,
    minVolumeToRebalance: 1000,
    minFeePerTvl24h: 0.05,
    autoSwapAfterClaim: true,
  },
  telegram: {
    authorizedChatIds: ["123456"],
  },
  schedule: {
    managementIntervalMin: 5,
    screeningIntervalMin: 30,
    evolutionIntervalHours: 6,
    healthCheckIntervalMin: 60,
  },
  runtime: {
    dryRun: true,
  },
};

test("validates a valid config", () => {
  const result = ConfigSchema.safeParse(validConfig);
  expect(result.success).toBe(true);
});

test("rejects invalid preset value", () => {
  const bad = { ...validConfig, preset: "not_custom" };
  const result = ConfigSchema.safeParse(bad);
  expect(result.success).toBe(false);
});

test("rejects missing required fields", () => {
  const { risk, ...incomplete } = validConfig;
  const result = ConfigSchema.safeParse(incomplete);
  expect(result.success).toBe(false);
});

test("rejects missing credentials fields", () => {
  const { credentials, ...rest } = validConfig;
  const result = ConfigSchema.safeParse({ ...rest, credentials: { rpcUrl: "https://rpc.example.com" } });
  expect(result.success).toBe(false);
});

test("applies telegram defaults when omitted", () => {
  const { telegram: _, ...withoutTelegram } = validConfig as any;
  const result = ConfigSchema.safeParse(withoutTelegram);
  // Should fail because authorizedChatIds is required
  expect(result.success).toBe(false);
});

test("accepts all valid timeframe values", () => {
  for (const tf of ["5m", "15m", "30m", "1h", "4h", "24h"]) {
    const config = { ...validConfig, screening: { ...validConfig.screening, timeframe: tf } };
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  }
});

test("accepts all valid management strategies", () => {
  for (const s of ["spot", "curve", "bid_ask", "single_sided_reseed", "fee_compounding", "partial_harvest"]) {
    const config = { ...validConfig, management: { ...validConfig.management, strategy: s } };
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  }
});

const TEST_CONFIG_PATH = "/tmp/dlmm-test-config.json";

test("loadConfig returns defaults when file missing", () => {
  if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
  const config = loadConfig(TEST_CONFIG_PATH);
  expect(config.preset).toBe("custom");
  expect(config.runtime.dryRun).toBe(true);
});

test("loadConfig merges partial file with defaults", () => {
  writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
    credentials: {
      rpcUrl: "https://rpc.example.com",
      walletKey: "secret",
      heliusApiKey: "key",
      telegramBotToken: "token",
    },
  }));

  const config = loadConfig(TEST_CONFIG_PATH);
  expect(config.credentials.rpcUrl).toBe("https://rpc.example.com");
  expect(config.runtime.dryRun).toBe(true); // from defaults
  unlinkSync(TEST_CONFIG_PATH);
});

test("loadConfig resolves env overrides", () => {
  writeFileSync(TEST_CONFIG_PATH, JSON.stringify(validConfig));
  process.env.LLM_API_KEY = "env-key-123";

  const config = loadConfig(TEST_CONFIG_PATH);
  expect(config.llm.apiKey).toBe("env-key-123");

  delete process.env.LLM_API_KEY;
  unlinkSync(TEST_CONFIG_PATH);
});

test("loadConfig rejects invalid config file", () => {
  writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ preset: "wrong" }));
  expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow("Config validation failed");
  unlinkSync(TEST_CONFIG_PATH);
});

test("saveConfig writes valid JSON", () => {
  const parsed = ConfigSchema.parse(validConfig);
  saveConfig(parsed, TEST_CONFIG_PATH);

  const reloaded = loadConfig(TEST_CONFIG_PATH);
  expect(reloaded.preset).toBe("custom");
  expect(reloaded.credentials.rpcUrl).toBe("https://rpc.example.com");
  unlinkSync(TEST_CONFIG_PATH);
});
