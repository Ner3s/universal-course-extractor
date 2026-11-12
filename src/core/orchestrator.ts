import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AiProvider } from "../ai/ai-provider.interface.js";
import { CliUsageError } from "../cli/errors.js";
import { headedOverride, validateScrapeOptions, type ScrapeOptions } from "../cli/options.js";
import type { Ui } from "../cli/prompts/prompts.js";
import { ProgressReporter } from "../cli/progress-reporter.js";
import type { AppConfig } from "../config/config.schema.js";
import { findCourse } from "../discovery/course-discovery.js";
import {
  hasSelection,
  parseNumberList,
  resolveSelection,
  selectLessons,
} from "../discovery/lesson-discovery.js";
import { buildFileNames, resolveOutputDir } from "../processors/file-naming.js";
import type { CoursePlatformAdapter } from "../platforms/contracts/course-platform-adapter.js";
import type { PlatformResolver, PlatformRuntime } from "../platforms/runtime.js";
import type { CourseRepository } from "../storage/repositories/course.repository.js";
import type { ProgressRepository } from "../storage/repositories/progress.repository.js";
import type { ConflictPolicy } from "../storage/writers/markdown-writer.js";
import type { Course, Lesson } from "../types/index.js";
import { CourseRunner, type RunSummary } from "./course-runner.js";
import type { ProcessorFactory } from "./pipeline.js";

export interface OrchestratorDeps {
  config: AppConfig;
  logger: Logger;
  ui: Ui;
  out: (line: string) => void;
  platforms: PlatformResolver;
  courses: CourseRepository;
  progress: ProgressRepository;
  ai: AiProvider;
  createProcessor: ProcessorFactory;
  signal?: AbortSignal;
}

interface Connected {
  runtime: PlatformRuntime;
  adapter: CoursePlatformAdapter;
}

/** Coordena o fluxo completo. Não conhece nenhuma plataforma específica. */
export class Orchestrator {
  constructor(private readonly d: OrchestratorDeps) {}

  // ---- comandos --------------------------------------------------------

  async auth(o: ScrapeOptions): Promise<boolean> {
    validateScrapeOptions(o);
    return this.withPlatform(o, async ({ adapter }) => {
      this.d.out(`Authenticated on ${adapter.name}. Session saved for future runs.`);
      return true;
    });
  }

  async listCourses(o: ScrapeOptions): Promise<Course[]> {
    validateScrapeOptions(o);
    return this.withPlatform(o, async ({ adapter }) => {
      const courses = await adapter.getCourses();
      this.d.logger.info({ count: courses.length }, "Courses found");
      courses.forEach((c, i) => this.d.out(`${i + 1}. ${c.title} (${c.lessons.length} lessons) - ${c.url}`));
      return courses;
    });
  }

  async listLessons(o: ScrapeOptions): Promise<Lesson[]> {
    validateScrapeOptions(o);
    return this.withPlatform(o, async ({ adapter }) => {
      const course = await this.pickCourse(adapter, o);
      this.printLessons(course.lessons);
      return course.lessons;
    });
  }

  async scrape(o: ScrapeOptions): Promise<RunSummary | undefined> {
    validateScrapeOptions(o);
    if (!o.dryRun) await this.checkAi();

    return this.withPlatform(o, async ({ adapter }) => {
      const { out, ui, config } = this.d;
      const course = await this.pickCourse(adapter, o);
      const total = course.lessons.length;
      out(`\nCourse: ${course.title} (${total} lessons)`);
      this.printLessons(course.lessons);

      const positions = hasSelection(o)
        ? resolveSelection(o, total)
        : this.parseInteractive(await ui.askLessonSelection(course.lessons), total);
      const selected = selectLessons(course.lessons, positions);

      const defaultDir = resolveOutputDir(course.title, undefined, config.outputDir);
      const outputDir = o.output ?? (o.yes || o.dryRun ? defaultDir : await ui.input("Diretório de saída", defaultDir));

      const names = buildFileNames(selected, total);
      const existing = selected.filter((l) => this.isExisting(l, join(outputDir, names.get(l.position)!)));
      out(`\nSelected ${selected.length} lesson(s): ${selected.length - existing.length} new, ${existing.length} existing`);
      for (const l of selected) {
        const mark = existing.includes(l) ? "exists" : "new";
        out(`  ${String(l.position).padStart(2)}. ${l.title} -> ${names.get(l.position)} [${mark}]`);
      }
      out(`Output: ${outputDir}`);

      if (o.dryRun) {
        out("\nDry run: nothing was processed or written.");
        return undefined;
      }
      if (!o.yes && !(await ui.confirm("Iniciar o processamento?"))) {
        out("Cancelled.");
        return undefined;
      }

      this.d.courses.upsert(course);
      return this.run({
        adapter,
        course,
        lessons: selected,
        totalLessons: total,
        outputDir,
        o,
      });
    });
  }

  async resume(o: ScrapeOptions): Promise<RunSummary[]> {
    validateScrapeOptions(o);
    const records = this.d.progress.findResumable();
    if (records.length === 0) {
      this.d.out("Nothing to resume.");
      return [];
    }
    await this.checkAi();

    const byCourse = new Map<string, typeof records>();
    for (const r of records) byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]);

    const summaries: RunSummary[] = [];
    for (const [courseId, recs] of byCourse) {
      const courseRec = this.d.courses.get(courseId);
      if (!courseRec) continue;
      if (o.course && !courseRec.title.toLowerCase().includes(o.course.toLowerCase())) continue;
      this.d.out(`\nResuming "${courseRec.title}": ${recs.length} lesson(s)`);
      const s = await this.withPlatform(
        { ...o, url: courseRec.url, platform: courseRec.platform },
        async ({ adapter }) => {
          const lessons: Lesson[] = recs.map((r) => ({
            id: r.id, platform: r.platform, courseId: r.courseId, title: r.title, url: r.url, position: r.position,
          }));
          const all = this.d.progress.listByCourse(courseId);
          const outputDir = o.output ?? resolveOutputDir(courseRec.title, undefined, this.d.config.outputDir);
          return this.run({
            adapter,
            course: courseRec,
            lessons,
            totalLessons: Math.max(...all.map((r) => r.position)),
            outputDir,
            o,
          });
        },
      );
      summaries.push(s);
    }
    return summaries;
  }

  // ---- internos --------------------------------------------------------

  private async run(a: {
    adapter: CoursePlatformAdapter;
    course: Pick<Course, "id" | "title" | "platform" | "url">;
    lessons: Lesson[];
    totalLessons: number;
    outputDir: string;
    o: ScrapeOptions;
  }): Promise<RunSummary> {
    const reporter = new ProgressReporter(this.d.out);
    const policy: ConflictPolicy = a.o.overwrite ? "overwrite" : a.o.skipExisting ? "skip" : "ask";
    const processor = this.d.createProcessor({
      adapter: a.adapter,
      policy,
      resolveConflict: policy === "ask" ? (info) => this.d.ui.askConflict(info) : undefined,
      onProgress: (e) => reporter.event(e),
    });
    const runner = new CourseRunner(processor, this.d.progress, this.d.logger);
    this.d.out("\nUniversal Course Knowledge Extractor");
    this.d.out(`Platform: ${a.course.platform}\nCourse: ${a.course.title}`);
    const summary = await runner.run({
      course: a.course,
      lessons: a.lessons,
      totalLessons: a.totalLessons,
      outputDir: a.outputDir,
      skipExisting: a.o.skipExisting,
      force: a.o.overwrite,
      signal: this.d.signal,
      onLessonStart: (l, i, n) => reporter.header(l, i, n),
      onLessonEnd: (_l, outcome) => {
        if (outcome.status === "skipped") reporter.skipped(outcome.path);
      },
    });
    reporter.summary(summary);
    return summary;
  }

  private async checkAi(): Promise<void> {
    this.d.out("Checking AI endpoint...");
    const r = await this.d.ai.checkConnection();
    for (const w of r.warnings) this.d.out(`  [!!] ${w}`);
    this.d.out("  [OK] AI endpoint reachable");
  }

  /** Abre a plataforma, autentica e garante o fechamento do navegador. */
  private async withPlatform<T>(o: ScrapeOptions, fn: (c: Connected) => Promise<T>): Promise<T> {
    const url = o.url ?? (await this.d.ui.input("URL da plataforma ou do curso"));
    if (!url) throw new CliUsageError("A URL is required");
    const runtime = await this.d.platforms.resolve({ url, platform: o.platform, headed: headedOverride(o) });
    const adapter = runtime.adapter;
    this.d.out(`Platform: ${adapter.name}`);
    try {
      await runtime.open();
      adapter.setStartUrl?.(url);
      const auth = await adapter.authenticate();
      if (!auth.authenticated && adapter.name !== "generic") {
        throw new Error(`Authentication failed: ${auth.message ?? "unknown reason"}. Run "auth" and try again.`);
      }
      return await fn({ runtime, adapter });
    } finally {
      await runtime.close().catch((err) => this.d.logger.warn({ err: String(err) }, "Error closing platform"));
    }
  }

  private async pickCourse(adapter: CoursePlatformAdapter, o: ScrapeOptions): Promise<Course> {
    const courses = await adapter.getCourses();
    if (courses.length === 0) throw new Error("No courses found");
    if (o.course) return findCourse(courses, o.course);
    if (courses.length === 1) return courses[0]!;
    return this.d.ui.selectCourse(courses);
  }

  private printLessons(lessons: Lesson[]) {
    for (const l of lessons) this.d.out(`  ${String(l.position).padStart(2)}. ${l.title}`);
  }

  private parseInteractive(text: string, total: number): number[] {
    const t = text.trim().toLowerCase();
    if (t === "all" || t === "todas" || t === "") return resolveSelection({ all: true }, total);
    const list = parseNumberList(t);
    return resolveSelection({ lessons: list.join(",") }, total);
  }

  private isExisting(lesson: Lesson, path: string): boolean {
    const rec = this.d.progress.get(lesson.id);
    const recorded =
      (rec?.status === "completed" || rec?.status === "partial") && !!rec.outputPath && existsSync(rec.outputPath);
    return recorded || existsSync(path);
  }
}
