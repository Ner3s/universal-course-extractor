import type { Logger } from "pino";
import { buildFileNames } from "../processors/file-naming.js";
import type { ProgressRepository } from "../storage/repositories/progress.repository.js";
import type { Course, Lesson } from "../types/index.js";
import type { LessonOutcome, LessonProcessor } from "./lesson-processor.js";

export interface RunOptions {
  course: Pick<Course, "id" | "title" | "platform" | "url">;
  /** Aulas selecionadas, em ordem de posição. */
  lessons: Lesson[];
  /** Total de aulas do curso (define a largura do prefixo numérico). */
  totalLessons: number;
  outputDir: string;
  skipExisting?: boolean;
  /** Descarta resultados intermediários antes de processar (reprocessamento forçado). */
  force?: boolean;
  signal?: AbortSignal;
  onLessonStart?: (lesson: Lesson, index: number, total: number) => void;
  onLessonEnd?: (lesson: Lesson, outcome: LessonOutcome, index: number, total: number) => void;
}

export interface RunSummary {
  total: number;
  completed: number;
  partial: number;
  skipped: number;
  failed: number;
  interrupted: boolean;
  results: Array<{ lesson: Lesson; outcome: LessonOutcome }>;
}

/** Executa as aulas em sequência; a falha de uma aula não interrompe as demais (§17). */
export class CourseRunner {
  constructor(
    private readonly processor: LessonProcessor,
    private readonly progress: ProgressRepository,
    private readonly logger: Logger,
  ) {}

  async run(opts: RunOptions): Promise<RunSummary> {
    const names = buildFileNames(opts.lessons, opts.totalLessons);
    const summary: RunSummary = {
      total: opts.lessons.length,
      completed: 0, partial: 0, skipped: 0, failed: 0,
      interrupted: false,
      results: [],
    };

    // Registra todas como pending para que `resume` conheça a seleção.
    for (const l of opts.lessons) {
      this.progress.upsertLesson(l);
      if (opts.force) this.progress.reset(l.id);
    }

    for (const [i, lesson] of opts.lessons.entries()) {
      if (opts.signal?.aborted) {
        summary.interrupted = true;
        this.logger.warn("Run interrupted; progress saved for resume");
        break;
      }
      opts.onLessonStart?.(lesson, i, opts.lessons.length);
      const outcome = await this.processor.process({
        lesson,
        courseTitle: opts.course.title,
        outputDir: opts.outputDir,
        fileName: names.get(lesson.position)!,
        skipExisting: opts.skipExisting,
      });
      summary[outcome.status] += 1;
      summary.results.push({ lesson, outcome });
      opts.onLessonEnd?.(lesson, outcome, i, opts.lessons.length);
    }
    return summary;
  }
}
