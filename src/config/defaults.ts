export const DEFAULTS = {
  ai: {
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "local",
    model: "local-model",
    temperature: 0.2,
    maxTokens: 8192,
    timeoutMs: 120_000,
    maxRetries: 3,
    chunkChars: 6000,
  },
  dataDir: "data",
  outputDir: "dist",
  logLevel: "info",
} as const;
