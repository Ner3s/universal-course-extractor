import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import type { Summarizer } from "../ai/summarizer.js";
import type { MarkdownTranslator } from "../processors/markdown-translator.js";
import { cleanTranscript } from "../processors/transcript-cleaner.js";
import { htmlToMarkdown } from "../processors/html-to-markdown.js";
import { composeMarkdown } from "../processors/markdown-composer.js";
import type { CoursePlatformAdapter } from "../platforms/contracts/course-platform-adapter.js";
import type { TranscriptStore } from "../extraction/transcript-store.js";
import type { MarkdownWriter } from "../storage/writers/markdown-writer.js";
import {
  detectCompletedStages,
  type ProgressRepository,
} from "../storage/repositories/progress.repository.js";
import type { Lesson } from "../types/index.js";

export type StepName = "transcript" | "content" | "summary" | "translation" | "write";
export type StepState = "start" | "done" | "reused" | "warn" | "failed";

export interface ProgressEvent {
  lesson: Lesson;
  step: StepName;
  state: StepState;
  detail?: string;
}

export interface LessonProcessorDeps {
  adapter: CoursePlatformAdapter & { getLessonTitle?(lesson: Lesson): Promise<string | undefined> };
  progress: ProgressRepository;
  transcriptStore: TranscriptStore;
  summarizer: Summarizer;
  translator: MarkdownTranslator;
  writer: MarkdownWriter;
  logger: Logger;
  onProgress?: (e: ProgressEvent) => void;
}

export interface LessonJob {
  lesson: Lesson;
  courseTitle: string;
  outputDir: string;
  fileName: string;
  /** Pula a aula (sem trabalho de IA) se já existir resultado final registrado ou arquivo no destino. */
  skipExisting?: boolean;
}

export type LessonOutcome =
  | { status: "completed" | "partial"; path: string; warnings: string[] }
  | { status: "skipped"; path: string }
  | { status: "failed"; error: string; stage: StepName };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Processa uma aula retomando de onde parou (etapas já persistidas não são refeitas). */
export class LessonProcessor {
  constructor(private readonly d: LessonProcessorDeps) {}

  private emit(lesson: Lesson, step: StepName, state: StepState, detail?: string) {
    this.d.onProgress?.({ lesson, step, state, detail });
  }

  async process(job: LessonJob): Promise<LessonOutcome> {
    const { lesson } = job;
    const { progress, logger } = this.d;
    const existing = progress.upsertLesson(lesson);
    if (job.skipExisting) {
      const recorded =
        (existing.status === "completed" || existing.status === "partial") &&
        existing.outputPath !== undefined &&
        existsSync(existing.outputPath);
      if (recorded) return { status: "skipped", path: existing.outputPath! };
      if (this.d.writer.exists(job.outputDir, job.fileName)) {
        return { status: "skipped", path: job.outputDir + "/" + job.fileName };
      }
    }
    let stage: StepName = "transcript";
    const warnings: string[] = [];

    try {
      const done = () => detectCompletedStages(progress.get(lesson.id));

      // 1. Transcrição
      if (!done().transcript) {
        this.emit(lesson, "transcript", "start");
        progress.setStatus(lesson.id, "extracting");
        const t = await this.d.adapter.getTranscript(lesson);
        if (t.status === "found" || t.status === "partial") {
          const path = await this.d.transcriptStore.save(lesson, t);
          progress.saveStage(lesson.id, {
            transcriptPath: path ?? null,
            transcriptStatus: t.status,
            transcriptSource: t.source,
            transcriptComplete: t.complete,
            transcriptWarnings: t.warnings ?? null,
          });
          progress.setStatus(lesson.id, "transcript_extracted");
          if (t.status === "partial") {
            warnings.push("Transcript is partial/unverified", ...(t.warnings ?? []));
            this.emit(lesson, "transcript", "warn", (t.warnings ?? []).join("; "));
          } else {
            this.emit(lesson, "transcript", "done", t.source);
          }
          logger.info({ lesson: lesson.id, source: t.source, complete: t.complete }, "Transcript extracted");
        } else {
          const reason = t.status === "failed" ? t.error : t.reason;
          progress.saveStage(lesson.id, { transcriptStatus: t.status, transcriptWarnings: [reason] });
          warnings.push(`Transcript ${t.status}: ${reason}`);
          this.emit(lesson, "transcript", "warn", `${t.status}: ${reason}`);
          logger.warn({ lesson: lesson.id, status: t.status, reason }, "Transcript not available");
        }
      } else {
        this.emit(lesson, "transcript", "reused");
      }

      // 2. Conteúdo HTML → Markdown
      stage = "content";
      let title = lesson.title;
      if (!done().content) {
        this.emit(lesson, "content", "start");
        progress.setStatus(lesson.id, "extracting");
        const content = await this.d.adapter.getLessonContent(lesson);
        const converted = htmlToMarkdown(content.html);
        if (!converted.markdown.trim()) throw new Error("Lesson content is empty after conversion");
        warnings.push(...converted.warnings);
        progress.saveStage(lesson.id, {
          contentHash: sha256(content.html),
          contentMarkdown: converted.markdown,
        });
        progress.setStatus(lesson.id, "content_extracted");
        this.emit(lesson, "content", "done");
      } else {
        this.emit(lesson, "content", "reused");
      }
      const extractedTitle = await this.d.adapter.getLessonTitle?.(lesson).catch(() => undefined);
      if (extractedTitle) title = extractedTitle;

      // 3. Resumo (somente a transcrição; nunca o conteúdo traduzido)
      stage = "summary";
      let record = progress.get(lesson.id)!;
      if (!record.summary && record.transcriptPath) {
        this.emit(lesson, "summary", "start");
        progress.setStatus(lesson.id, "summarizing");
        const raw = await readFile(record.transcriptPath, "utf8");
        const summary = await this.d.summarizer.summarize(cleanTranscript(raw));
        progress.saveStage(lesson.id, { summary });
        this.emit(lesson, "summary", "done");
      } else if (record.summary) {
        this.emit(lesson, "summary", "reused");
      }

      // 4. Tradução integral (entrada: Markdown do conteúdo; independente do resumo)
      stage = "translation";
      record = progress.get(lesson.id)!;
      if (!record.translation) {
        this.emit(lesson, "translation", "start");
        progress.setStatus(lesson.id, "translating");
        const tr = await this.d.translator.translate(record.contentMarkdown!);
        progress.saveStage(lesson.id, { translation: tr.markdown });
        this.emit(lesson, "translation", "done", `${tr.chunks} chunk(s)`);
      } else {
        this.emit(lesson, "translation", "reused");
      }

      // 5. Composição e escrita
      stage = "write";
      record = progress.get(lesson.id)!;
      const transcriptKnown = record.transcriptPath !== undefined;
      const note = composeMarkdown({
        title,
        platform: lesson.platform,
        courseTitle: job.courseTitle,
        lessonId: lesson.id,
        position: lesson.position,
        sourceUrl: lesson.url,
        summary: record.summary,
        transcript: {
          status: transcriptKnown
            ? record.transcriptComplete
              ? "found"
              : "partial"
            : ((record.transcriptStatus as "unavailable" | "failed" | "needs-speech-recognition" | undefined) ?? "unavailable"),
          source: record.transcriptSource,
          complete: record.transcriptComplete ?? false,
          warnings: record.transcriptWarnings,
        },
        translatedContent: record.translation!,
      });
      const w = await this.d.writer.write({
        dir: job.outputDir,
        fileName: job.fileName,
        content: note,
        lessonId: lesson.id,
      });
      if (w.status === "skipped") {
        this.emit(lesson, "write", "warn", "file exists; skipped");
        return { status: "skipped", path: w.path };
      }
      const complete = transcriptKnown && record.transcriptComplete === true;
      const finalStatus = complete ? "completed" : "partial";
      progress.markFinished(lesson.id, finalStatus, w.path);
      this.emit(lesson, "write", "done", w.path);
      logger.info({ lesson: lesson.id, path: w.path, status: finalStatus }, "Lesson file written");
      return { status: finalStatus, path: w.path, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress.setStatus(lesson.id, "failed", message);
      this.emit(lesson, stage, "failed", message);
      logger.error({ lesson: lesson.id, stage, error: message }, "Lesson failed");
      return { status: "failed", error: message, stage };
    }
  }
}
