import type { AiProvider } from "./ai-provider.interface.js";
import { TRANSLATE_SYSTEM, translatePrompt } from "./prompts/translate-content.js";

export class TruncatedOutputError extends Error {
  constructor() {
    super("Model output was truncated (finish_reason=length). Lower AI_CHUNK_CHARS or raise AI_MAX_TOKENS.");
    this.name = "TruncatedOutputError";
  }
}

/** Operação B: traduz um chunk de Markdown. Independente do resumo (§12.5). */
export class Translator {
  constructor(private readonly provider: AiProvider) {}

  async translateChunk(markdown: string): Promise<string> {
    const r = await this.provider.complete({
      system: TRANSLATE_SYSTEM,
      user: translatePrompt(markdown),
    });
    if (r.finishReason === "length") throw new TruncatedOutputError();
    return stripWrapper(r.text);
  }
}

/** Remove cercas/marcadores que alguns modelos adicionam ao redor da resposta. */
function stripWrapper(text: string): string {
  return text
    .replace(/^\s*<<<CONTEUDO>>>\s*/i, "")
    .replace(/\s*<<<FIM>>>\s*$/i, "")
    .trim();
}
