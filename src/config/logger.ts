import pino, { type Logger } from "pino";

export function createLogger(level = "info"): Logger {
  return pino({
    level,
    redact: ["password", "cookie", "cookies", "token", "apiKey", "*.apiKey", "authorization"],
  });
}
