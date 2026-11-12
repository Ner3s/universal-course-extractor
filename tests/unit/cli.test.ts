import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasSelection,
  parseNumberList,
  resolveSelection,
  selectLessons,
  validateSelectionInput,
} from "../../src/discovery/lesson-discovery.js";
import { findCourse } from "../../src/discovery/course-discovery.js";
import { validateScrapeOptions } from "../../src/cli/options.js";
import { CliUsageError } from "../../src/cli/errors.js";
import { createProgram, type CommandName } from "../../src/cli/cli.js";
import { formatEvent, formatLessonHeader, formatSummary } from "../../src/cli/progress-reporter.js";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { createProcessorFactory } from "../../src/core/pipeline.js";
import { loadAppConfig } from "../../src/config/config.loader.js";
import { openDatabase } from "../../src/storage/database.js";
import { CourseRepository } from "../../src/storage/repositories/course.repository.js";
import { ProgressRepository } from "../../src/storage/repositories/progress.repository.js";
import type { AiProvider } from "../../src/ai/ai-provider.interface.js";
import type { Ui } from "../../src/cli/prompts/prompts.js";
import type { PlatformResolver } from "../../src/platforms/runtime.js";
import { FakeAdapter } from "../fixtures/fake-adapter.js";
import type { Course, Lesson } from "../../src/types/index.js";

const logger = pino({ level: "silent" });

describe("seleção de aulas", () => {
  it("parseNumberList aceita listas e intervalos", () => {
    expect(parseNumberList("1, 3,5-7")).toEqual([1, 3, 5, 6, 7]);
    expect(() => parseNumberList("a")).toThrow(CliUsageError);
    expect(() => parseNumberList("5-2")).toThrow(/greater/);
    expect(() => parseNumberList(" , ")).toThrow(/No lesson/);
  });
  it("resolve cada modo usando posições a partir de 1", () => {
    expect(resolveSelection({ lesson: 2 }, 5)).toEqual([2]);
    expect(resolveSelection({ lessons: "5,1,3,3" }, 5)).toEqual([1, 3, 5]);
    expect(resolveSelection({ from: 2, to: 4 }, 5)).toEqual([2, 3, 4]);
    expect(resolveSelection({ from: 4 }, 5)).toEqual([4, 5]);
    expect(resolveSelection({ to: 2 }, 5)).toEqual([1, 2]);
    expect(resolveSelection({ all: true }, 3)).toEqual([1, 2, 3]);
  });
  it("rejeita fora do intervalo, zero, from>to e combinações conflitantes", () => {
    expect(() => resolveSelection({ lesson: 9 }, 5)).toThrow(/out of range: 9/);
    expect(() => resolveSelection({ lessons: "0,1" }, 5)).toThrow(/out of range/);
    expect(() => validateSelectionInput({ lesson: 0 })).toThrow(/>= 1/);
    expect(() => validateSelectionInput({ from: 5, to: 2 })).toThrow(/must not be greater/);
    expect(() => validateSelectionInput({ lesson: 1, all: true })).toThrow(/Conflicting/);
    expect(() => validateSelectionInput({ lessons: "1", from: 1 })).toThrow(/Conflicting/);
    expect(() => resolveSelection({}, 5)).toThrow(/No lessons selected/);
    expect(() => resolveSelection({ all: true }, 0)).toThrow(/no lessons/);
  });
  it("hasSelection e selectLessons", () => {
    expect(hasSelection({})).toBe(false);
    expect(hasSelection({ to: 3 })).toBe(true);
    const ls = [1, 2, 3].map((position) => ({ position }) as Lesson);
    expect(selectLessons(ls, [1, 3]).map((l) => l.position)).toEqual([1, 3]);
  });
});

describe("findCourse", () => {
  const cs = [{ title: "Claude Basics" }, { title: "Claude Code" }, { title: "Other" }] as Course[];
  it("exato, parcial e erros", () => {
    expect(findCourse(cs, "claude basics").title).toBe("Claude Basics");
    expect(findCourse(cs, "other").title).toBe("Other");
    expect(() => findCourse(cs, "claude")).toThrow(/ambiguous/);
    expect(() => findCourse(cs, "zzz")).toThrow(/not found/);
  });
});

describe("validateScrapeOptions", () => {
  it("rejeita conflitos e URLs inválidas", () => {
    expect(() => validateScrapeOptions({ overwrite: true, skipExisting: true })).toThrow(/--overwrite and --skip-existing/);
    expect(() => validateScrapeOptions({ headed: true, headless: true })).toThrow(/--headed and --headless/);
    expect(() => validateScrapeOptions({ url: "ftp://x" })).toThrow(/Invalid --url/);
    expect(() => validateScrapeOptions({ url: "nope" })).toThrow(/Invalid --url/);
    expect(() => validateScrapeOptions({ url: "https://x.com", all: true })).not.toThrow();
  });
});

describe("createProgram", () => {
  async function parse(args: string[]) {
    const calls: Array<[CommandName, Record<string, unknown>]> = [];
    const p = createProgram(async (c, o) => void calls.push([c, o as Record<string, unknown>]));
    await p.parseAsync(["node", "scrape", ...args]);
    return calls[0]!;
  }
  it("mapeia as opções do spec", async () => {
    const [cmd, o] = await parse(["--url", "https://x.com/c", "--lessons", "1,3,5", "--skip-existing", "--output", "out", "--dry-run", "--headless", "-y"]);
    expect(cmd).toBe("scrape");
    expect(o).toMatchObject({ url: "https://x.com/c", lessons: "1,3,5", skipExisting: true, output: "out", dryRun: true, headless: true, yes: true });
  });
  it("converte números e aceita --all / --from --to", async () => {
    expect((await parse(["--lesson", "2"]))[1]).toMatchObject({ lesson: 2 });
    expect((await parse(["--from", "1", "--to", "5"]))[1]).toMatchObject({ from: 1, to: 5 });
    expect((await parse(["--all"]))[1]).toMatchObject({ all: true });
  });
  it("subcomandos: auth, courses, lessons --course, resume, check-config, test-ai", async () => {
    expect((await parse(["auth"]))[0]).toBe("auth");
    expect((await parse(["courses"]))[0]).toBe("courses");
    const [c, o] = await parse(["lessons", "--course", "Nome do curso"]);
    expect(c).toBe("lessons");
    expect(o).toMatchObject({ course: "Nome do curso" });
    expect((await parse(["resume"]))[0]).toBe("resume");
    expect((await parse(["check-config"]))[0]).toBe("check-config");
    expect((await parse(["test-ai"]))[0]).toBe("test-ai");
  });
  it("rejeita número inválido", async () => {
    const p = createProgram(async () => {}).exitOverride().configureOutput({ writeErr: () => {} });
    await expect(p.parseAsync(["node", "scrape", "--lesson", "x"])).rejects.toThrow();
  });
});

describe("progress reporter", () => {
  const lesson = { title: "Intro" } as Lesson;
  it("formata no estilo do spec", () => {
    expect(formatLessonHeader(lesson, 0, 12)).toContain("[1/12] Intro");
    expect(formatEvent({ lesson, step: "transcript", state: "done", detail: "text-track" })).toBe("  [OK] Transcript extracted (text-track)");
    expect(formatEvent({ lesson, step: "translation", state: "start" })).toBe("  [..] Translating content...");
    expect(formatEvent({ lesson, step: "write", state: "done" })).toBe("  [OK] Markdown saved");
    expect(formatEvent({ lesson, step: "summary", state: "failed", detail: "x" })).toContain("[XX]");
  });
  it("resumo mostra progresso, falhas e dica de resume", () => {
    const text = formatSummary(
      { total: 3, completed: 1, partial: 0, skipped: 1, failed: 1, interrupted: false,
        results: [{ lesson: { position: 3, title: "C" } as Lesson, outcome: { status: "failed", error: "boom", stage: "translation" } }] },
      3,
    );
    expect(text).toContain("Progress: 1/3 lessons written, 1 skipped, 1 failed");
    expect(text).toContain("boom");
    expect(text).toContain("resume");
  });
});

// ---------------------------------------------------------------------------

class CliFakeAdapter extends FakeAdapter {
  constructor() {
    super("fake", "fake.example.com");
  }
  override async getLessonContent(l: Lesson) {
    return { html: `<p>hello ${l.id}</p>`, extractedAt: new Date(), source: "t" };
  }
  override async getTranscript() {
    return { status: "found" as const, text: "Hi.", source: "text-track" as const, complete: true };
  }
}

describe("Orchestrator", () => {
  let dir: string;
  let out: string[];
  let adapter: CliFakeAdapter;
  let ai: AiProvider & { checks: number };
  let ui: Ui;
  let opened: number;
  let closed: number;
  let orch: Orchestrator;
  let progress: ProgressRepository;
  let courses: CourseRepository;
  let authenticated: boolean;
  let config: ReturnType<typeof loadAppConfig>;

  function platforms(): PlatformResolver {
    const runtime = {
      adapter,
      open: async () => void opened++,
      close: async () => void closed++,
    };
    return {
      names: () => ["fake"],
      byName: () => runtime,
      resolve: async ({ url, platform }) => {
        if (!platform && !(await adapter.canHandle(url!))) throw new Error("Unsupported course platform");
        return runtime;
      },
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orch-"));
    config = { ...loadAppConfig({}), dataDir: join(dir, "data"), outputDir: join(dir, "dist") };
    out = [];
    opened = closed = 0;
    authenticated = true;
    adapter = new CliFakeAdapter();
    adapter.authenticate = async () => ({ authenticated, message: "no session" });
    ai = {
      checks: 0,
      async complete(req) {
        return { text: req.system.includes("tradutor") ? req.user.replace(/<<<CONTEUDO>>>\n?|\n?<<<FIM>>>/g, "") : "Resumo." };
      },
      async checkConnection() {
        this.checks++;
        return { models: [], warnings: [] };
      },
    };
    ui = {
      input: vi.fn(async (_m, d) => d ?? ""),
      confirm: vi.fn(async () => true),
      selectCourse: vi.fn(async (cs) => cs[0]!),
      askLessonSelection: vi.fn(async () => "all"),
      askConflict: vi.fn(async () => "skip" as const),
    };
    const db = openDatabase(":memory:");
    courses = new CourseRepository(db);
    progress = new ProgressRepository(db);
    orch = new Orchestrator({
      config, logger, ui, out: (l) => out.push(l), platforms: platforms(), courses, progress, ai,
      createProcessor: createProcessorFactory(config, logger, progress, ai),
    });
  });

  const url = "https://fake.example.com/course";

  it("fluxo completo não interativo: verifica IA, processa, grava e fecha o navegador", async () => {
    const s = await orch.scrape({ url, lessons: "1,3", output: join(dir, "notes"), yes: true });
    expect(s).toMatchObject({ total: 2, completed: 2 });
    expect(ai.checks).toBe(1);
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(await readdir(join(dir, "notes"))).toEqual(["01-aula-1.md", "03-aula-3.md"]);
    expect(closed).toBe(1);
    expect(out.join("\n")).toContain("[1/2] Aula 1");
    expect(out.join("\n")).toContain("2 new, 0 existing");
    expect(courses.get("c1")).toBeDefined();
  });

  it("fluxo interativo pergunta seleção, diretório e confirmação", async () => {
    (ui.askLessonSelection as ReturnType<typeof vi.fn>).mockResolvedValue("2-3");
    const s = await orch.scrape({ url });
    expect(ui.askLessonSelection).toHaveBeenCalled();
    expect(ui.input).toHaveBeenCalledWith("Diretório de saída", expect.stringContaining("curso"));
    expect(ui.confirm).toHaveBeenCalled();
    expect(s?.total).toBe(2);
  });

  it("recusar a confirmação cancela sem processar", async () => {
    (ui.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    expect(await orch.scrape({ url, all: true })).toBeUndefined();
    expect(progress.listByCourse("c1")).toHaveLength(0);
    expect(closed).toBe(1);
  });

  it("dry-run lista o plano sem IA, sem escrita e sem perguntas", async () => {
    const s = await orch.scrape({ url, all: true, dryRun: true, output: join(dir, "d") });
    expect(s).toBeUndefined();
    expect(ai.checks).toBe(0);
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("Dry run");
    await expect(readdir(join(dir, "d"))).rejects.toThrow();
  });

  it("informa aulas novas e existentes e respeita --skip-existing", async () => {
    const o = { url, all: true, yes: true, output: join(dir, "n") };
    await orch.scrape(o);
    out.length = 0;
    const s = await orch.scrape({ ...o, skipExisting: true });
    expect(s).toMatchObject({ skipped: 3, completed: 0 });
    expect(out.join("\n")).toContain("0 new, 3 existing");
  });

  it("padrão pergunta ao usuário em conflito; overwrite não pergunta", async () => {
    const o = { url, lesson: 1, yes: true, output: join(dir, "c") };
    await orch.scrape(o);
    const s = await orch.scrape(o);
    expect(ui.askConflict).toHaveBeenCalledTimes(1);
    expect(s?.skipped).toBe(1);
    await orch.scrape({ ...o, overwrite: true });
    expect(ui.askConflict).toHaveBeenCalledTimes(1);
  });

  it("não inicia o curso se a IA estiver inacessível", async () => {
    ai.checkConnection = async () => {
      throw new Error("Cannot reach AI endpoint");
    };
    await expect(orch.scrape({ url, all: true, yes: true })).rejects.toThrow(/Cannot reach/);
    expect(opened).toBe(0);
  });

  it("erro claro para opções conflitantes e falha de autenticação (fecha o navegador)", async () => {
    await expect(orch.scrape({ url, all: true, lesson: 1 })).rejects.toThrow(CliUsageError);
    authenticated = false;
    await expect(orch.scrape({ url, all: true, yes: true })).rejects.toThrow(/Authentication failed/);
    expect(closed).toBe(1);
  });

  it("auth, courses e lessons", async () => {
    expect(await orch.auth({ url })).toBe(true);
    expect(await orch.listCourses({ url })).toHaveLength(1);
    expect(await orch.listLessons({ url, course: "curso" })).toHaveLength(3);
    expect(out.join("\n")).toContain("1. Aula 1");
  });

  it("resume retoma aulas com falha reutilizando o registro", async () => {
    const o = { url, all: true, yes: true, output: join(dir, "r") };
    let fail = true;
    const orig = adapter.getLessonContent.bind(adapter);
    adapter.getLessonContent = async (l) => {
      if (l.position === 2 && fail) throw new Error("boom");
      return orig(l);
    };
    const first = await orch.scrape(o);
    expect(first?.failed).toBe(1);
    fail = false;
    out.length = 0;
    const [second] = await orch.resume({ output: o.output, yes: true });
    expect(second).toMatchObject({ total: 1, completed: 1 });
    expect(await readdir(o.output)).toEqual(["01-aula-1.md", "02-aula-2.md", "03-aula-3.md"]);
    expect(await orch.resume({})).toEqual([]);
    expect(out.join("\n")).toContain("Nothing to resume");
  });
});
