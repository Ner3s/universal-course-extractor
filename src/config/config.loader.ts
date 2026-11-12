import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import {
  appConfigSchema,
  platformsFileSchema,
  type AppConfig,
  type PlatformsFile,
} from "./config.schema.js";
import { DEFAULTS } from "./defaults.js";

type Env = Record<string, string | undefined>;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  return Number(value); // NaN é rejeitado pelo Zod
}

/** Constrói e valida a configuração a partir de variáveis de ambiente. */
export function loadAppConfig(env: Env = process.env): AppConfig {
  return appConfigSchema.parse({
    ai: {
      baseUrl: env.AI_BASE_URL ?? DEFAULTS.ai.baseUrl,
      apiKey: env.AI_API_KEY ?? DEFAULTS.ai.apiKey,
      model: env.AI_MODEL ?? DEFAULTS.ai.model,
      temperature: num(env.AI_TEMPERATURE, DEFAULTS.ai.temperature),
      maxTokens: num(env.AI_MAX_TOKENS, DEFAULTS.ai.maxTokens),
      timeoutMs: num(env.AI_TIMEOUT, DEFAULTS.ai.timeoutMs),
      maxRetries: num(env.AI_MAX_RETRIES, DEFAULTS.ai.maxRetries),
      chunkChars: num(env.AI_CHUNK_CHARS, DEFAULTS.ai.chunkChars),
    },
    dataDir: env.DATA_DIR ?? DEFAULTS.dataDir,
    outputDir: env.OUTPUT_DIR ?? DEFAULTS.outputDir,
    logLevel: env.LOG_LEVEL ?? DEFAULTS.logLevel,
  });
}

/** Valida o conteúdo YAML de configuração de plataformas. */
export function parsePlatformsConfig(yamlText: string): PlatformsFile {
  return platformsFileSchema.parse(parse(yamlText));
}

export function loadPlatformsConfig(
  path = "config/platforms.yaml",
  fallbackPath = "config/platforms.example.yaml",
): PlatformsFile {
  const file = existsSync(path) ? path : fallbackPath;
  return parsePlatformsConfig(readFileSync(file, "utf8"));
}
