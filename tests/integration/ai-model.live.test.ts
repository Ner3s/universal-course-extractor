import "dotenv/config";
import { describe, it, expect } from "vitest";
import pino from "pino";
import { loadAppConfig } from "../../src/config/config.loader.js";
import { OpenAiCompatibleClient } from "../../src/ai/ai-client.js";
import { Summarizer } from "../../src/ai/summarizer.js";
import { Translator } from "../../src/ai/translator.js";
import { MarkdownTranslator } from "../../src/processors/markdown-translator.js";
import { SAMPLE_MARKDOWN, SAMPLE_TRANSCRIPT } from "../../src/ai/ai-tester.js";

const config = loadAppConfig();
const logger = pino({ level: "silent" });
const client = new OpenAiCompatibleClient(config.ai, logger);

describe(`Live AI Model (${config.ai.model} @ ${config.ai.baseUrl})`, () => {
  it("conecta ao endpoint e responde ao ping inicial", async () => {
    const report = await client.checkConnection();
    expect(Array.isArray(report.models)).toBe(true);
  });

  it("gera resumo de transcrição em português (Summarizer)", async () => {
    const summarizer = new Summarizer(client, { chunkChars: config.ai.chunkChars, logger });
    const summary = await summarizer.summarize(SAMPLE_TRANSCRIPT);
    expect(summary.trim().length).toBeGreaterThan(40);
  });

  it("traduz Markdown preservando blocos de código, links, listas e tabelas (MarkdownTranslator)", async () => {
    const translator = new MarkdownTranslator(new Translator(client), {
      chunkChars: config.ai.chunkChars,
      maxRetries: config.ai.maxRetries,
      logger,
    });
    const result = await translator.translate(SAMPLE_MARKDOWN);
    expect(result.chunks).toBe(1);
    expect(result.markdown).toContain("https://docs.anthropic.com/en/docs/welcome");
    expect(result.markdown).toContain('const response = await client.complete({ model: "local", temperature: 0.2 });');
    expect(result.markdown).not.toContain("[[[CODE_BLOCK_");
  });
});
