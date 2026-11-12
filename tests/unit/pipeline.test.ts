import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LessonProcessor, type ProgressEvent } from "../../src/core/lesson-processor.js";
import { CourseRunner } from "../../src/core/course-runner.js";
import { openDatabase } from "../../src/storage/database.js";
import { CourseRepository } from "../../src/storage/repositories/course.repository.js";
import { ProgressRepository } from "../../src/storage/repositories/progress.repository.js";
import { TranscriptStore } from "../../src/extraction/transcript-store.js";
import { MarkdownWriter } from "../../src/storage/writers/markdown-writer.js";
import { Summarizer } from "../../src/ai/summarizer.js";
import { Translator } from "../../src/ai/translator.js";
import { MarkdownTranslator } from "../../src/processors/markdown-translator.js";
import type { AiProvider, CompletionRequest } from "../../src/ai/ai-provider.interface.js";
import type { Lesson, TranscriptResult } from "../../src/types/index.js";
import type { CoursePlatformAdapter } from "../../src/platforms/contracts/index.js";
import { FakeAdapter } from "../fixtures/fake-adapter.js";

const logger = pino({ level: "silent" });
const course = { id: "c1", platform: "fake", title: "Curso Teste", url: "https://f/c" };
const lessons: Lesson[] = [1, 2, 3].map((n) => ({
  id: `fake-${n}`, platform: "fake", courseId: "c1", title: `Aula ${n}`, url: `https://f/c/${n}`, position: n,
}));

const goodTranscript: TranscriptResult = {
  status: "found", text: "Hello there. This is the lesson.", source: "text-track", complete: true,
  segments: [{ start: 0, end: 5, text: "Hello there." }],
};

class StubAdapter extends FakeAdapter {
  transcriptCalls = 0;
  contentCalls = 0;
  failContentFor = new Set<string>();
  transcript: TranscriptResult = goodTranscript;
  constructor() {
    super("fake", "f");
  }
  override async getTranscript(_l: Lesson) {
    this.transcriptCalls++;
    return this.transcript;
  }
  override async getLessonContent(l: Lesson) {
    this.contentCalls++;
    if (this.failContentFor.has(l.id)) throw new Error("page crashed");
    return { html: `<h2>Heading ${l.id}</h2><p>hello world</p>`, extractedAt: new Date(), source: "stub" };
  }
}

let dir: string;
let adapter: StubAdapter;
let progress: ProgressRepository;
let aiCalls: CompletionRequest[];
let failTranslationOnce: boolean;
let events: ProgressEvent[];

function build(policy: "overwrite" | "skip" = "overwrite") {
  const provider: AiProvider = {
    async complete(req) {
      aiCalls.push(req);
      if (req.system.includes("tradutor")) {
        if (failTranslationOnce) {
          failTranslationOnce = false;
          return { text: "" };
        }
        return { text: req.user.replace(/<<<CONTEUDO>>>\n?|\n?<<<FIM>>>/g, "").replace("hello world", "olá mundo") };
      }
      return { text: "Resumo gerado.\n\n### Principais conceitos\n\n- A\n\n### Pontos importantes\n\n- B" };
    },
    async checkConnection() {
      return { models: [], warnings: [] };
    },
  };
  const processor = new LessonProcessor({
    adapter: adapter as CoursePlatformAdapter,
    progress,
    transcriptStore: new TranscriptStore(join(dir, "transcripts")),
    summarizer: new Summarizer(provider, { chunkChars: 2000 }),
    translator: new MarkdownTranslator(new Translator(provider), { chunkChars: 2000, maxRetries: 0 }),
    writer: new MarkdownWriter(policy),
    logger,
    onProgress: (e) => events.push(e),
  });
  return new CourseRunner(processor, progress, logger);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pipe-"));
  const db = openDatabase(":memory:");
  new CourseRepository(db).upsert(course);
  progress = new ProgressRepository(db);
  adapter = new StubAdapter();
  aiCalls = [];
  failTranslationOnce = false;
  events = [];
});

const run = (runner: CourseRunner, extra: Record<string, unknown> = {}) =>
  runner.run({ course, lessons, totalLessons: 3, outputDir: join(dir, "out"), ...extra });

describe("pipeline", () => {
  it("gera uma nota por aula, em ordem, com o formato esperado", async () => {
    const s = await run(build());
    expect(s).toMatchObject({ total: 3, completed: 3, failed: 0 });
    const note = await readFile(join(dir, "out", "02-aula-2.md"), "utf8");
    expect(note).toContain("# Aula 2");
    expect(note).toContain("## Resumo da transcrição");
    expect(note).toContain("Resumo gerado.");
    expect(note).toContain("> [!note]- Transcrição completa");
    expect(note).toContain("> Hello there. This is the lesson.");
    expect(note).toContain("## Conteúdo da aula");
    expect(note).toContain("olá mundo");
    expect(progress.get("fake-2")).toMatchObject({ status: "completed" });
    expect(existsSync(join(dir, "transcripts", "fake", "fake-1.txt"))).toBe(true);
  });

  it("resumo recebe só a transcrição e tradução só o conteúdo (operações independentes)", async () => {
    await run(build());
    const summaryCalls = aiCalls.filter((c) => !c.system.includes("tradutor"));
    const translateCalls = aiCalls.filter((c) => c.system.includes("tradutor"));
    expect(summaryCalls.every((c) => c.user.includes("Hello there") && !c.user.includes("Heading"))).toBe(true);
    expect(translateCalls.every((c) => c.user.includes("Heading") && !c.user.includes("Resumo gerado"))).toBe(true);
  });

  it("falha em uma aula não interrompe as demais", async () => {
    adapter.failContentFor.add("fake-2");
    const s = await run(build());
    expect(s).toMatchObject({ completed: 2, failed: 1 });
    expect(progress.get("fake-2")).toMatchObject({ status: "failed", error: "page crashed" });
    expect(events.some((e) => e.lesson.id === "fake-2" && e.state === "failed")).toBe(true);
  });

  it("retoma sem refazer transcrição, conteúdo e resumo quando só a tradução falhou", async () => {
    failTranslationOnce = true;
    const first = await run(build(), {});
    expect(first.failed).toBe(1);
    expect(progress.get("fake-1")!.status).toBe("failed");
    expect(progress.get("fake-1")!.summary).toBeTruthy();

    const transcriptBefore = adapter.transcriptCalls;
    const contentBefore = adapter.contentCalls;
    const summariesBefore = aiCalls.filter((c) => !c.system.includes("tradutor")).length;

    const second = await run(build(), {});
    expect(second.completed).toBe(3);
    // Nada é refeito: apenas a tradução que falhou é chamada novamente.
    expect(adapter.transcriptCalls).toBe(transcriptBefore);
    expect(adapter.contentCalls).toBe(contentBefore);
    expect(aiCalls.filter((c) => !c.system.includes("tradutor")).length).toBe(summariesBefore);
    expect(events.filter((e) => e.lesson.id === "fake-1" && e.step === "translation" && e.state === "start")).toHaveLength(2);
  });

  it("skipExisting pula aulas já registradas sem chamar adapter nem IA", async () => {
    await run(build());
    const t = adapter.transcriptCalls;
    const ai = aiCalls.length;
    const s = await run(build(), { skipExisting: true });
    expect(s).toMatchObject({ skipped: 3, completed: 0 });
    expect(adapter.transcriptCalls).toBe(t);
    expect(aiCalls.length).toBe(ai);
  });

  it("skipExisting também reconhece arquivo existente no destino mesmo sem registro", async () => {
    const out = join(dir, "out");
    await run(build(), { lessons: [lessons[0]!], skipExisting: false });
    const fresh = openDatabase(":memory:");
    new CourseRepository(fresh).upsert(course);
    progress = new ProgressRepository(fresh);
    const s = await run(build(), { lessons: [lessons[0]!], skipExisting: true });
    expect(s.skipped).toBe(1);
    expect(existsSync(out)).toBe(true);
  });

  it("transcrição indisponível gera nota parcial com aviso de resumo indisponível", async () => {
    adapter.transcript = { status: "unavailable", reason: "no captions" };
    const s = await run(build(), { lessons: [lessons[0]!] });
    expect(s.partial).toBe(1);
    expect(progress.get("fake-1")!.status).toBe("partial");
    const note = await readFile(join(dir, "out", "01-aula-1.md"), "utf8");
    expect(note).toContain("Resumo indisponível");
    expect(note).toContain("olá mundo");
    expect(aiCalls.every((c) => c.system.includes("tradutor"))).toBe(true);
  });

  it("transcrição parcial é sinalizada na nota e nunca marcada como completa", async () => {
    adapter.transcript = { ...goodTranscript, status: "partial", complete: false, warnings: ["Low temporal coverage"] };
    const s = await run(build(), { lessons: [lessons[0]!] });
    expect(s.partial).toBe(1);
    const note = await readFile(join(dir, "out", "01-aula-1.md"), "utf8");
    expect(note).toContain("possivelmente incompleta");
    expect(note).toContain("Low temporal coverage");
    expect(note).toContain("transcript_complete: false");
  });

  it("respeita AbortSignal e mantém progresso para retomada", async () => {
    const ac = new AbortController();
    const s = await run(build(), { signal: ac.signal, onLessonEnd: () => ac.abort() });
    expect(s.interrupted).toBe(true);
    expect(s.completed).toBe(1);
    expect(progress.findResumable("c1").map((r) => r.id)).toEqual(["fake-2", "fake-3"]);
  });

  it("não sobrescreve arquivo existente com policy skip", async () => {
    await writeFileSafe(join(dir, "out", "01-aula-1.md"), "ORIGINAL");
    const s = await run(build("skip"), { lessons: [lessons[0]!] });
    expect(s.skipped).toBe(1);
    expect(await readFile(join(dir, "out", "01-aula-1.md"), "utf8")).toBe("ORIGINAL");
  });

  it("processa aula somente com vídeo (sem texto escrito na página) como completed", async () => {
    adapter.getLessonContent = async () => ({ html: "", extractedAt: new Date(), source: "video-only" });
    const s = await run(build(), { lessons: [lessons[0]!] });
    expect(s.completed).toBe(1);
    const note = await readFile(join(dir, "out", "01-aula-1.md"), "utf8");
    expect(note).toContain("Resumo gerado.");
    expect(note).toContain("> [!note]- Transcrição completa");
    expect(note).toContain("_Esta aula contém apenas vídeo (sem material textual adicional na página)._");
  });

  it("processa aula somente de texto (sem vídeo) como completed sem aviso de erro", async () => {
    adapter.transcript = { status: "unavailable", reason: "No video in this lesson" };
    const s = await run(build(), { lessons: [lessons[0]!] });
    expect(s.completed).toBe(1);
    const note = await readFile(join(dir, "out", "01-aula-1.md"), "utf8");
    expect(note).toContain("_Aula somente textual (sem vídeo)._");
    expect(note).toContain("olá mundo");
  });
});

async function writeFileSafe(path: string, content: string) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
