// src/config/loader.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ConfigSchema, type Config } from "./schema";
import { defaultConfig } from "./defaults";
import { logger } from "../utils/logger";

export function loadConfig(path: string = "config.json"): Config {
  if (!existsSync(path)) {
    logger.warn(`Config file not found at ${path}, using defaults with env overrides`);
    return resolveEnvVars(defaultConfig);
  }

    try {
        const raw = JSON.parse(readFileSync(path, "utf-8"));
        const merged = deepMerge(defaultConfig, raw) as Config;
        const config = resolveEnvVars(merged);

        const result = ConfigSchema.safeParse(config);
    if (!result.success) {
      const errors = result.error.errors.map(e => `  ${e.path.join(".")}: ${e.message}`).join("\n");
      throw new Error(`Config validation failed:\n${errors}`);
    }

    logger.info({ path }, "Config loaded and validated");
    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Config validation")) {
      throw error;
    }
    throw new Error(`Failed to load config from ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

export function saveConfig(config: Config, path: string = "config.json"): void {
  const json = JSON.stringify(config, null, 2);
  writeFileSync(path, json, "utf-8");
  logger.info({ path }, "Config saved");
}

function resolveEnvVars(config: Config): Config {
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const authorizedIds = [...(config.telegram?.authorizedChatIds || [])];
  
  if (telegramChatId && !authorizedIds.includes(telegramChatId)) {
      authorizedIds.push(telegramChatId);
  }

  return {
    ...config,
    credentials: {
      ...config.credentials,
      walletKey: process.env.SOLANA_PRIVATE_KEY || config.credentials?.walletKey,
      heliusApiKey: process.env.HELIUS_API_KEY || config.credentials?.heliusApiKey,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || config.credentials?.telegramBotToken,
    },
    telegram: {
      ...(config.telegram || { enabled: true, notifyOnTrade: true, receiveCommands: true, authorizedChatIds: [] }),
      authorizedChatIds: authorizedIds,
    },
    llm: {
      ...config.llm,
      baseUrl: process.env.LLM_BASE_URL || config.llm?.baseUrl,
      apiKey: process.env.LLM_API_KEY || config.llm?.apiKey,
      model: process.env.LLM_MODEL || config.llm?.model,
    },
  };
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
