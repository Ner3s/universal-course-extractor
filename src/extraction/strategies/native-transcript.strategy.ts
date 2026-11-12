import type { TranscriptStrategy } from "../strategy.js";

/**
 * Transcrição textual exposta diretamente na página (§10.1).
 * Requer o seletor `transcript` na configuração da plataforma; sem ele
 * a estratégia não se aplica (não inventamos seletores).
 */
export class NativeTranscriptStrategy implements TranscriptStrategy {
  readonly name = "native";

  async extract({ page, selectors }: Parameters<TranscriptStrategy["extract"]>[0]) {
    const sel = selectors.transcript;
    if (!sel?.trim()) return null;
    const count = await page.locator(sel).count();
    if (count === 0) return null;
    const text = (await page.locator(sel).first().innerText()).replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return null;
    return {
      status: "partial" as const,
      text,
      source: "native" as const,
      // Texto sem tempos: não há evidência de completude.
      complete: false,
      warnings: ["Native transcript has no timing information; completeness cannot be verified"],
      metadata: { selector: sel },
    };
  }
}
