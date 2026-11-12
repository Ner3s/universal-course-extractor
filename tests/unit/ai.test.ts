import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { chunkText, chunkMarkdown, protectCodeBlocks, restoreCodeBlocks } from "../../src/processors/transcript-chunker.js";
import { cleanTranscript } from "../../src/processors/transcript-cleaner.js";
import { Summarizer } from "../../src/ai/summarizer.js";
import { Translator } from "../../src/ai/translator.js";
import {
  MarkdownTranslator,
  TranslationError,
  validateTranslatedChunk,
} from "../../src/processors/markdown-translator.js";
import { OpenAiCompatibleClient } from "../../src/ai/ai-client.js";
import { AiConnectionError, type AiProvider, type CompletionRequest } from "../../src/ai/ai-provider.interface.js";
import { runAiDiagnostics } from "../../src/ai/ai-tester.js";
import { loadAppConfig } from "../../src/config/config.loader.js";

const logger = pino({ level: "silent" });

function fakeProvider(fn: (req: CompletionRequest, call: number) => string | { text: string; finishReason?: string }): AiProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const r = fn(req, calls.length);
      return typeof r === "string" ? { text: r } : r;
    },
    async checkConnection() {
      return { models: [], warnings: [] };
    },
  };
}

describe("chunkText", () => {
  it("retorna um chunk quando cabe", () => {
    expect(chunkText("abc", 100)).toEqual(["abc"]);
    expect(chunkText("  ", 100)).toEqual([]);
  });
  it("respeita o limite e preserva todo o conteúdo e ordem", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}.`).join(" ");
    const chunks = chunkText(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text);
  });
  it("divide palavras gigantes", () => {
    const chunks = chunkText("x".repeat(250), 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });
  it("prefere fronteiras de parágrafo", () => {
    const chunks = chunkText("aaaa\n\nbbbb\n\ncccc", 10);
    expect(chunks).toEqual(["aaaa\n\nbbbb", "cccc"]);
  });
});

describe("markdown protection", () => {
  const md = "Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro\n\n~~~\nraw\n~~~";
  it("troca blocos de código por placeholders e restaura idêntico", () => {
    const p = protectCodeBlocks(md);
    expect(p.blocks).toHaveLength(2);
    expect(p.text).not.toContain("const a");
    expect(restoreCodeBlocks(p.text, p.blocks)).toBe(md);
  });
  it("trata cerca não fechada como código", () => {
    const p = protectCodeBlocks("a\n```\nunclosed");
    expect(p.blocks).toHaveLength(1);
    expect(restoreCodeBlocks(p.text, p.blocks)).toBe("a\n```\nunclosed");
  });
  it("chunkMarkdown mantém tabelas inteiras", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    const chunks = chunkMarkdown(`para one\n\n${table}\n\npara two`, 30);
    expect(chunks.some((c) => c.includes(table))).toBe(true);
  });
});

describe("cleanTranscript", () => {
  it("remove ruído, repetições e agrupa em parágrafos", () => {
    const out = cleanTranscript("[Music]\nHello world.\nHello world.\n >> Next   line. ");
    expect(out).toBe("Hello world. Next line.");
  });
});

describe("Summarizer", () => {
  it("resumo direto para transcrições curtas, com tag de dado não confiável", async () => {
    const p = fakeProvider(() => "RESUMO");
    const s = new Summarizer(p, { chunkChars: 1000 });
    expect(await s.summarize("short text")).toBe("RESUMO");
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.user).toContain("<<<CONTEUDO>>>");
    expect(p.calls[0]!.system).toMatch(/NÃO CONFIÁVEL/);
  });
  it("hierárquico para transcrições longas: chunks → consolidação", async () => {
    const p = fakeProvider((req) => (req.user.includes("Consolide") ? "FINAL" : "nota"));
    const s = new Summarizer(p, { chunkChars: 500 });
    const text = Array.from({ length: 60 }, (_, i) => `Frase ${i} sobre algo importante.`).join(" ");
    expect(await s.summarize(text)).toBe("FINAL");
    expect(p.calls.length).toBeGreaterThan(2);
    expect(p.calls.at(-1)!.user).toContain("Consolide");
  });
  it("rejeita transcrição vazia e saída vazia", async () => {
    await expect(new Summarizer(fakeProvider(() => "x"), { chunkChars: 100 }).summarize(" ")).rejects.toThrow();
    await expect(new Summarizer(fakeProvider(() => " "), { chunkChars: 100 }).summarize("a")).rejects.toThrow(/empty/);
  });
  it("o prompt de resumo não é o de tradução", async () => {
    const p = fakeProvider(() => "x");
    await new Summarizer(p, { chunkChars: 100 }).summarize("a");
    expect(p.calls[0]!.system).not.toMatch(/TRADUÇÃO/);
  });
});

describe("validateTranslatedChunk", () => {
  it("aceita tradução fiel", () => {
    expect(validateTranslatedChunk("# Title\n\nSee https://a.com/x now", "# Título\n\nVeja https://a.com/x agora")).toEqual([]);
  });
  it("detecta placeholder perdido, link perdido, heading e tabela alterados", () => {
    expect(validateTranslatedChunk("[[[CODE_BLOCK_0]]]", "nada").join()).toMatch(/placeholders/);
    expect(validateTranslatedChunk("see https://a.com", "veja").join()).toMatch(/Links/);
    expect(validateTranslatedChunk("# A\n\ntext", "text").join()).toMatch(/Heading/);
    expect(validateTranslatedChunk("| a |\n| b |", "| a |").join()).toMatch(/Table/);
  });
  it("detecta resumo no lugar da tradução", () => {
    const src = "word ".repeat(200);
    expect(validateTranslatedChunk(src, "curto").join()).toMatch(/shorter/);
  });
});

describe("MarkdownTranslator", () => {
  const upper = (req: CompletionRequest) => req.user.replace(/<<<CONTEUDO>>>\n?|\n?<<<FIM>>>/g, "").replace(/hello/g, "olá");

  it("traduz em múltiplos chunks, na ordem, sem enviar código ao modelo", async () => {
    const md = ["# Hello", "hello one", "```js\nhello()\n```", "hello two", "hello three"].join("\n\n");
    const p = fakeProvider(upper);
    const mt = new MarkdownTranslator(new Translator(p), { chunkChars: 25, maxRetries: 1, logger });
    const r = await mt.translate(md);
    expect(r.chunks).toBeGreaterThan(1);
    expect(r.markdown).toContain("```js\nhello()\n```"); // código intocado
    expect(r.markdown.indexOf("um")).toBe(-1);
    expect(r.markdown.indexOf("olá one")).toBeLessThan(r.markdown.indexOf("olá three"));
    expect(p.calls.every((c) => !c.user.includes("hello()"))).toBe(true);
  });

  it("repete apenas o chunk que falhou", async () => {
    const md = "para one is here\n\npara two is here\n\npara three is here";
    let failedOnce = false;
    const p = fakeProvider((req) => {
      if (req.user.includes("two") && !failedOnce) {
        failedOnce = true;
        return "";
      }
      return upper(req);
    });
    const mt = new MarkdownTranslator(new Translator(p), { chunkChars: 20, maxRetries: 2, logger });
    const r = await mt.translate(md);
    expect(r.chunks).toBe(3);
    expect(p.calls).toHaveLength(4); // 3 chunks + 1 repetição
  });

  it("falha com TranslationError após exceder as tentativas", async () => {
    const p = fakeProvider(() => "");
    const mt = new MarkdownTranslator(new Translator(p), { chunkChars: 100, maxRetries: 2, logger });
    await expect(mt.translate("text")).rejects.toBeInstanceOf(TranslationError);
    expect(p.calls).toHaveLength(3);
  });

  it("trata saída truncada (finish_reason=length) como falha", async () => {
    const p = fakeProvider(() => ({ text: "parcial", finishReason: "length" }));
    const mt = new MarkdownTranslator(new Translator(p), { chunkChars: 100, maxRetries: 0, logger });
    await expect(mt.translate("text")).rejects.toThrow(/truncated/);
  });

  it("conteúdo vazio não chama o modelo", async () => {
    const p = fakeProvider(() => "x");
    expect((await new MarkdownTranslator(new Translator(p), { chunkChars: 100, maxRetries: 0 }).translate(" ")).chunks).toBe(0);
    expect(p.calls).toHaveLength(0);
  });
});

describe("OpenAiCompatibleClient", () => {
  const config = loadAppConfig({}).ai;
  const sdk = (over: { list?: () => Promise<unknown>; create?: () => Promise<unknown> }) =>
    ({
      models: { list: over.list ?? (async () => ({ data: [{ id: "local-model" }] })) },
      chat: { completions: { create: over.create ?? (async () => ({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] })) } },
    }) as never;

  it("complete retorna texto e finish_reason", async () => {
    const c = new OpenAiCompatibleClient(config, logger, sdk({}));
    expect(await c.complete({ system: "s", user: "u" })).toEqual({ text: "OK", finishReason: "stop" });
  });
  it("checkConnection ok", async () => {
    const r = await new OpenAiCompatibleClient(config, logger, sdk({})).checkConnection();
    expect(r.models).toEqual(["local-model"]);
    expect(r.warnings).toEqual([]);
  });
  it("avisa quando o modelo não está listado", async () => {
    const r = await new OpenAiCompatibleClient({ ...config, model: "other" }, logger, sdk({})).checkConnection();
    expect(r.warnings[0]).toMatch(/not listed/);
  });
  it("erro claro quando o endpoint não está acessível", async () => {
    const c = new OpenAiCompatibleClient(config, logger, sdk({ list: async () => { throw new Error("fetch failed ECONNREFUSED"); } }));
    await expect(c.checkConnection()).rejects.toBeInstanceOf(AiConnectionError);
  });
  it("tolera falha ao listar modelos mas falha se a requisição de teste falhar", async () => {
    const ok = new OpenAiCompatibleClient(config, logger, sdk({ list: async () => { throw new Error("404"); } }));
    expect((await ok.checkConnection()).warnings[0]).toMatch(/Could not list/);
    const bad = new OpenAiCompatibleClient(config, logger, sdk({ create: vi.fn(async () => { throw new Error("model not found"); }) }));
    await expect(bad.checkConnection()).rejects.toThrow(/model not found/);
  });
  it("valida a configuração", () => {
    expect(() => new OpenAiCompatibleClient({ ...config, baseUrl: "x" }, logger)).toThrow();
  });
});

describe("runAiDiagnostics", () => {
  const config = loadAppConfig({}).ai;

  it("passa quando conexão, resumo e tradução Markdown funcionam", async () => {
    const out: string[] = [];
    const provider = fakeProvider((req) => {
      if (req.system.includes("tradutor")) {
        return req.user.replace(/<<<CONTEUDO>>>\n?|\n?<<<FIM>>>/g, "");
      }
      return "Visão geral.\n\n### Principais conceitos\n\n- Prompt\n\n### Pontos importantes\n\n- Temperatura";
    });
    const report = await runAiDiagnostics({ config, provider, logger, out: (l) => out.push(l) });
    expect(report.ok).toBe(true);
    expect(report.steps.map((s) => [s.name, s.ok])).toEqual([
      ["connection", true],
      ["summarizer", true],
      ["translator", true],
    ]);
    expect(out.join("\n")).toContain("AI test passed: all 3/3 checks succeeded");
  });

  it("interrompe imediatamente quando a conexão com o endpoint falha", async () => {
    const provider: AiProvider = {
      async complete() {
        return { text: "OK" };
      },
      async checkConnection() {
        throw new AiConnectionError("Cannot reach AI endpoint http://127.0.0.1:8080/v1");
      },
    };
    const report = await runAiDiagnostics({ config, provider, logger });
    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({ name: "connection", ok: false });
  });

  it("reporta falha se o modelo corromper placeholders ou estrutura na tradução", async () => {
    const provider = fakeProvider((req) => {
      if (req.system.includes("tradutor")) return "Tradução inválida sem estrutura nem código";
      return "### Principais conceitos\n- Ok";
    });
    const report = await runAiDiagnostics({ config: { ...config, maxRetries: 0 }, provider, logger });
    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.name === "summarizer")?.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "translator")?.ok).toBe(false);
  });
});
