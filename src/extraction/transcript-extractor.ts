import type { TranscriptResult } from "../types/index.js";
import type { TranscriptStrategy, TranscriptStrategyContext } from "./strategy.js";

/** Engine: executa estratégias em ordem e escolhe o melhor resultado (§10). */
export class TranscriptExtractor {
  constructor(private readonly strategies: TranscriptStrategy[]) {}

  async extract(ctx: TranscriptStrategyContext): Promise<TranscriptResult> {
    let best: Extract<TranscriptResult, { status: "partial" | "found" }> | undefined;
    let speech: TranscriptResult | undefined;
    const failures: string[] = [];

    for (const strategy of this.strategies) {
      try {
        const r = await strategy.extract(ctx);
        if (!r) continue;
        ctx.logger.info({ strategy: strategy.name, status: r.status }, "Transcript strategy result");
        if (r.status === "found") return r;
        if (r.status === "partial") {
          if (!best || r.text.length > best.text.length) best = r;
        } else if (r.status === "needs-speech-recognition") {
          speech = r;
        } else if (r.status === "failed") {
          failures.push(`${strategy.name}: ${r.error}`);
        }
      } catch (err) {
        failures.push(`${strategy.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (best) {
      return { ...best, warnings: [...(best.warnings ?? []), ...failures.map((f) => `Strategy failed: ${f}`)] };
    }
    if (failures.length > 0) {
      return { status: "failed", error: failures.join("; ") };
    }
    return speech ?? { status: "unavailable", reason: "No transcript source available" };
  }
}
