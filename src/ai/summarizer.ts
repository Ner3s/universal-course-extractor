import type { Logger } from "pino";
import type { AiProvider } from "./ai-provider.interface.js";
import {
  SUMMARY_SYSTEM,
  chunkSummaryPrompt,
  consolidateSummaryPrompt,
  finalSummaryPrompt,
  mergeNotesPrompt,
} from "./prompts/summarize-transcript.js";
import { chunkText } from "../processors/transcript-chunker.js";
import { TruncatedOutputError } from "./translator.js";

export interface SummarizerOptions {
  chunkChars: number;
  logger?: Logger;
}

/** Operação A: resumo hierárquico da transcrição (§12.4). Recebe só a transcrição. */
export class Summarizer {
  constructor(
    private readonly provider: AiProvider,
    private readonly options: SummarizerOptions,
  ) {}

  private async ask(user: string): Promise<string> {
    const r = await this.provider.complete({ system: SUMMARY_SYSTEM, user });
    if (r.finishReason === "length") throw new TruncatedOutputError();
    const text = r.text.trim();
    if (!text) throw new Error("Model returned an empty summary");
    return text;
  }

  async summarize(transcript: string): Promise<string> {
    const max = this.options.chunkChars;
    const chunks = chunkText(transcript, max);
    if (chunks.length === 0) throw new Error("Cannot summarize an empty transcript");
    if (chunks.length === 1) return this.ask(finalSummaryPrompt(chunks[0]!));

    this.options.logger?.info({ chunks: chunks.length }, "Hierarchical summary");
    let notes: string[] = [];
    for (const [i, c] of chunks.entries()) {
      notes.push(await this.ask(chunkSummaryPrompt(c, i, chunks.length)));
    }

    // Reduz recursivamente até que as notas caibam em uma única consolidação.
    while (notes.join("\n\n").length > max) {
      const groups = groupBySize(notes, max);
      if (groups.length >= notes.length) break; // não reduz mais; consolida mesmo assim
      const merged: string[] = [];
      for (const g of groups) {
        merged.push(g.length === 1 ? g[0]! : await this.ask(mergeNotesPrompt(g.join("\n\n"))));
      }
      notes = merged;
    }
    return this.ask(consolidateSummaryPrompt(notes.join("\n\n")));
  }
}

function groupBySize(items: string[], max: number): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const it of items) {
    if (cur.length > 0 && len + it.length > max) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(it);
    len += it.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}
