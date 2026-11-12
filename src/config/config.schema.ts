import { z } from "zod";

export const aiConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  /** Tamanho máximo (caracteres) de cada chunk enviado ao modelo. */
  chunkChars: z.number().int().min(500),
});
export type AiConfig = z.infer<typeof aiConfigSchema>;

export const appConfigSchema = z.object({
  ai: aiConfigSchema,
  dataDir: z.string().min(1),
  outputDir: z.string().min(1),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const platformConfigSchema = z.object({
  enabled: z.boolean().default(true),
  domains: z.array(z.string().min(1)).default([]),
  selectors: z.record(z.string(), z.string()).default({}),
  browser: z
    .object({
      headed: z.boolean().default(true),
      navigation_timeout: z.number().int().positive().default(30000),
    })
    .default({ headed: true, navigation_timeout: 30000 }),
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const platformsFileSchema = z.object({
  platforms: z.record(z.string(), platformConfigSchema),
});
export type PlatformsFile = z.infer<typeof platformsFileSchema>;
