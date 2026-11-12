import type { Page } from "playwright";
import type { Logger } from "pino";
import type { TranscriptResult } from "../types/index.js";

export interface TranscriptStrategyContext {
  page: Page;
  logger: Logger;
  /** Seletores da plataforma (video, transcript, ...). Valores vazios = não configurado. */
  selectors: Record<string, string>;
}

/**
 * Retorna null quando a estratégia não se aplica (a cadeia segue para a próxima).
 * Retorna um TranscriptResult quando encontrou algo ou falhou de forma explícita.
 */
export interface TranscriptStrategy {
  readonly name: string;
  extract(ctx: TranscriptStrategyContext): Promise<TranscriptResult | null>;
}
