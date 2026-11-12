import type { Logger } from "pino";
import type { AiConfig } from "../config/config.schema.js";
import type { AiProvider } from "./ai-provider.interface.js";
import { Summarizer } from "./summarizer.js";
import { Translator } from "./translator.js";
import { MarkdownTranslator } from "../processors/markdown-translator.js";

export const SAMPLE_TRANSCRIPT = [
  "Welcome to this lesson on Prompt Engineering and Model Configuration.",
  "When working with large language models, the system prompt defines the assistant role, constraints, and output format.",
  "Setting a lower temperature, such as 0.2, makes the output more deterministic and reliable for technical tasks like translation and summarization.",
  "Always validate structured outputs and preserve code blocks and technical identifiers when processing documentation.",
].join(" ");

export const SAMPLE_MARKDOWN = [
  "# Introduction to Prompt Engineering",
  "",
  "System prompts define the behavior and boundaries of the model. Read the official guide at https://docs.anthropic.com/en/docs/welcome for complete reference.",
  "",
  "- Use clear and direct instructions",
  "- Provide structured context delimiters",
  "",
  "| Parameter | Purpose |",
  "| --- | --- |",
  "| temperature | Controls randomness |",
  "",
  "```ts",
  'const response = await client.complete({ model: "local", temperature: 0.2 });',
  "```",
].join("\n");

export interface AiStepResult {
  name: "connection" | "summarizer" | "translator";
  ok: boolean;
  durationMs: number;
  warnings: string[];
  sample?: string;
  error?: string;
}

export interface AiDiagnosticReport {
  ok: boolean;
  endpoint: string;
  model: string;
  models: string[];
  totalDurationMs: number;
  steps: AiStepResult[];
}

export interface AiTesterDeps {
  config: AiConfig;
  provider: AiProvider;
  logger?: Logger;
  out?: (line: string) => void;
}

/**
 * Executa uma bateria de diagnóstico no modelo de IA configurado:
 * 1. Conectividade e listagem de modelos (`/v1/models` + ping)
 * 2. Resumo real de transcrição (`Summarizer`)
 * 3. Tradução fiel de Markdown com validação de código, links, listas e tabelas (`MarkdownTranslator`)
 */
export async function runAiDiagnostics(deps: AiTesterDeps): Promise<AiDiagnosticReport> {
  const { config, provider, logger } = deps;
  const out = deps.out ?? (() => {});
  const startedAt = Date.now();
  const steps: AiStepResult[] = [];
  let models: string[] = [];

  out("Testing AI model configuration...");
  out(`  Endpoint:    ${config.baseUrl}`);
  out(`  Model:       ${config.model}`);
  out(`  Max tokens:  ${config.maxTokens}`);
  out(`  Chunk chars: ${config.chunkChars}`);
  out(`  Temperature: ${config.temperature}`);
  out("");

  // 1. Connectivity & model check
  out("[1/3] Checking endpoint connectivity and model availability...");
  const tConn = Date.now();
  try {
    const conn = await provider.checkConnection();
    const durationMs = Date.now() - tConn;
    models = conn.models;
    steps.push({
      name: "connection",
      ok: true,
      durationMs,
      warnings: conn.warnings,
    });
    for (const w of conn.warnings) out(`  [!!] ${w}`);
    out(`  [OK] Endpoint reachable (${durationMs}ms)${models.length ? ` — models: ${models.slice(0, 5).join(", ")}` : ""}`);
  } catch (err) {
    const durationMs = Date.now() - tConn;
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({
      name: "connection",
      ok: false,
      durationMs,
      warnings: [],
      error: msg,
    });
    out(`  [XX] Connection failed (${durationMs}ms): ${msg}`);
    return {
      ok: false,
      endpoint: config.baseUrl,
      model: config.model,
      models,
      totalDurationMs: Date.now() - startedAt,
      steps,
    };
  }

  // 2. Summarizer check
  out("[2/3] Testing transcript summarization (pt-BR)...");
  const tSum = Date.now();
  try {
    const summarizer = new Summarizer(provider, { chunkChars: config.chunkChars, logger });
    const summary = await summarizer.summarize(SAMPLE_TRANSCRIPT);
    const durationMs = Date.now() - tSum;
    const warnings: string[] = [];
    if (!/###\s+/.test(summary)) {
      warnings.push("Summary did not include '###' section headings requested by the prompt");
    }
    steps.push({
      name: "summarizer",
      ok: true,
      durationMs,
      warnings,
      sample: summary,
    });
    for (const w of warnings) out(`  [!!] ${w}`);
    out(`  [OK] Summary generated (${durationMs}ms, ${summary.length} chars)`);
  } catch (err) {
    const durationMs = Date.now() - tSum;
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({
      name: "summarizer",
      ok: false,
      durationMs,
      warnings: [],
      error: msg,
    });
    out(`  [XX] Summarization failed (${durationMs}ms): ${msg}`);
  }

  // 3. MarkdownTranslator check (preserves code blocks, links, headings, lists, tables)
  out("[3/3] Testing Markdown translation and structural preservation...");
  const tTrans = Date.now();
  try {
    const translator = new MarkdownTranslator(new Translator(provider), {
      chunkChars: config.chunkChars,
      maxRetries: config.maxRetries,
      logger,
    });
    const result = await translator.translate(SAMPLE_MARKDOWN);
    const durationMs = Date.now() - tTrans;
    steps.push({
      name: "translator",
      ok: true,
      durationMs,
      warnings: result.warnings,
      sample: result.markdown,
    });
    for (const w of result.warnings) out(`  [!!] ${w}`);
    out(
      `  [OK] Markdown translated and validated (${durationMs}ms, ${result.markdown.length} chars, code blocks & links preserved)`,
    );
  } catch (err) {
    const durationMs = Date.now() - tTrans;
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({
      name: "translator",
      ok: false,
      durationMs,
      warnings: [],
      error: msg,
    });
    out(`  [XX] Translation failed (${durationMs}ms): ${msg}`);
  }

  const totalDurationMs = Date.now() - startedAt;
  const ok = steps.every((s) => s.ok);
  out("");
  if (ok) {
    out(`AI test passed: all ${steps.length}/${steps.length} checks succeeded in ${totalDurationMs}ms.`);
  } else {
    const failed = steps.filter((s) => !s.ok).map((s) => s.name);
    out(`AI test failed: failed checks [${failed.join(", ")}] (${totalDurationMs}ms).`);
  }

  return {
    ok,
    endpoint: config.baseUrl,
    model: config.model,
    models,
    totalDurationMs,
    steps,
  };
}
