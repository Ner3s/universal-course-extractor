import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import pretty from "pino-pretty";

const REDACT = ["password", "cookie", "cookies", "token", "apiKey", "*.apiKey", "authorization"];

/** Logger simples (testes / check-config). */
export function createLogger(level = "info"): Logger {
  return pino({ level, redact: REDACT });
}

/**
 * Logs estruturados em arquivo (nível configurado) e legíveis no terminal
 * (stderr, somente avisos e erros, para não poluir a saída de progresso).
 */
export function createAppLogger(dataDir: string, level = "info"): Logger {
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true });
  return pino(
    { level: "trace", redact: REDACT },
    pino.multistream([
      { level: level as pino.Level, stream: pino.destination({ dest: join(dir, "app.log"), sync: true, mkdir: true }) },
      { level: "warn", stream: pretty({ colorize: true, destination: 2, sync: true, ignore: "pid,hostname" }) },
    ]),
  );
}
