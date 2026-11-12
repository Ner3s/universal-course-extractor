import type { Logger } from "pino";
import type { Translator } from "../ai/translator.js";
import {
  chunkMarkdown,
  protectCodeBlocks,
  restoreCodeBlocks,
} from "./transcript-chunker.js";

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly chunkIndex: number,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

const URL_RE = /\bhttps?:\/\/[^\s)>\]"']+/g;
const PLACEHOLDER_RE = /\[\[\[CODE_BLOCK_(\d+)\]\]\]/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

function countLines(text: string, re: RegExp): number {
  return text.split("\n").filter((l) => re.test(l)).length;
}

/** Valida um chunk traduzido contra o original (§11.3). Retorna lista de problemas. */
export function validateTranslatedChunk(source: string, output: string): string[] {
  const issues: string[] = [];
  if (!output.trim()) return ["Empty output"];

  const src = placeholders(source);
  const out = placeholders(output);
  if (src.join(",") !== out.join(",")) {
    issues.push("Code block placeholders were altered, lost or reordered");
  }

  const outUrls = new Set(output.match(URL_RE) ?? []);
  const missing = [...new Set(source.match(URL_RE) ?? [])].filter((u) => !outUrls.has(u.replace(/[.,;:]+$/, "")) && !outUrls.has(u));
  if (missing.length) issues.push(`Links lost: ${missing.slice(0, 3).join(", ")}`);

  const headings = /^\s{0,3}#{1,6}\s/;
  if (countLines(source, headings) !== countLines(output, headings)) {
    issues.push("Heading count differs");
  }
  const tableRow = /^\s*\|/;
  if (countLines(source, tableRow) !== countLines(output, tableRow)) {
    issues.push("Table rows differ");
  }
  const listItem = /^\s*([-*+]|\d+\.)\s/;
  if (countLines(source, listItem) !== countLines(output, listItem)) {
    issues.push("List item count differs");
  }

  // Tradução para pt-BR tende a ficar do mesmo tamanho ou maior; muito menor indica resumo.
  const plainSrc = source.replace(PLACEHOLDER_RE, "").trim().length;
  const plainOut = output.replace(PLACEHOLDER_RE, "").trim().length;
  if (plainSrc > 200 && plainOut < plainSrc * 0.6) {
    issues.push(`Output is much shorter than the source (${plainOut}/${plainSrc} chars): possible summary or omission`);
  }
  if (/^\s*(aqui está|here is|here's|claro,|certamente)/i.test(output)) {
    issues.push("Output contains an introductory remark");
  }
  return issues;
}

/** Verifica a estrutura global do Markdown final: cercas de código balanceadas. */
export function validateFinalMarkdown(markdown: string): string[] {
  const issues: string[] = [];
  const fences = markdown.split("\n").filter((l) => /^\s{0,3}(```|~~~)/.test(l)).length;
  if (fences % 2 !== 0) issues.push("Unbalanced code fences");
  if (/\[\[\[CODE_BLOCK_\d+\]\]\]/.test(markdown)) issues.push("Unrestored code block placeholder");
  return issues;
}

export interface MarkdownTranslatorOptions {
  chunkChars: number;
  /** Tentativas por chunk (além da primeira). */
  maxRetries: number;
  logger?: Logger;
}

export interface TranslationResult {
  markdown: string;
  chunks: number;
  warnings: string[];
}

export class MarkdownTranslator {
  constructor(
    private readonly translator: Translator,
    private readonly options: MarkdownTranslatorOptions,
  ) {}

  async translate(markdown: string): Promise<TranslationResult> {
    if (!markdown.trim()) return { markdown: "", chunks: 0, warnings: [] };
    const protectedMd = protectCodeBlocks(markdown);
    const chunks = chunkMarkdown(protectedMd.text, this.options.chunkChars);
    const results: string[] = [];

    for (const [i, chunk] of chunks.entries()) {
      results.push(await this.translateWithRetry(chunk, i, chunks.length));
    }
    if (results.length !== chunks.length) {
      throw new TranslationError("A chunk was lost", results.length, ["chunk count mismatch"]);
    }

    const restored = restoreCodeBlocks(results.join("\n\n"), protectedMd.blocks);
    const finalIssues = validateFinalMarkdown(restored);
    if (finalIssues.length) {
      throw new TranslationError(`Invalid final Markdown: ${finalIssues.join("; ")}`, -1, finalIssues);
    }
    return { markdown: restored, chunks: chunks.length, warnings: [] };
  }

  private async translateWithRetry(chunk: string, index: number, total: number): Promise<string> {
    const attempts = this.options.maxRetries + 1;
    let issues: string[] = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const out = await this.translator.translateChunk(chunk);
        issues = validateTranslatedChunk(chunk, out);
        if (issues.length === 0) return out;
      } catch (err) {
        issues = [err instanceof Error ? err.message : String(err)];
      }
      this.options.logger?.warn({ chunk: index + 1, total, attempt, issues }, "Translation chunk failed validation");
    }
    throw new TranslationError(
      `Chunk ${index + 1}/${total} failed after ${attempts} attempts: ${issues.join("; ")}`,
      index,
      issues,
    );
  }
}
