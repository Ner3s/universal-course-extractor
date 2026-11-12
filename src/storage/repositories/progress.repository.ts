import type { Database } from "../database.js";
import type { Lesson, LessonStatus } from "../../types/index.js";

export interface LessonRecord {
  id: string;
  courseId: string;
  platform: string;
  title: string;
  url: string;
  position: number;
  status: LessonStatus;
  processedAt?: string;
  outputPath?: string;
  error?: string;
  contentHash?: string;
  transcriptPath?: string;
  transcriptStatus?: string;
  transcriptSource?: string;
  transcriptComplete?: boolean;
  transcriptWarnings?: string[];
  contentMarkdown?: string;
  summary?: string;
  translation?: string;
  updatedAt: string;
}

/** Campos de etapa que podem ser gravados; `null` limpa o valor. */
export type StageUpdate = Partial<{
  contentHash: string | null;
  transcriptPath: string | null;
  transcriptStatus: string | null;
  transcriptSource: string | null;
  transcriptComplete: boolean | null;
  transcriptWarnings: string[] | null;
  contentMarkdown: string | null;
  summary: string | null;
  translation: string | null;
}>;

const COLUMN: Record<keyof StageUpdate, string> = {
  contentHash: "content_hash",
  transcriptPath: "transcript_path",
  transcriptStatus: "transcript_status",
  transcriptSource: "transcript_source",
  transcriptComplete: "transcript_complete",
  transcriptWarnings: "transcript_warnings",
  contentMarkdown: "content_markdown",
  summary: "summary",
  translation: "translation",
};

export interface CompletedStages {
  transcript: boolean;
  content: boolean;
  summary: boolean;
  translation: boolean;
}

/** Etapas cujo resultado já está persistido e não precisa ser refeito (§14.2). */
export function detectCompletedStages(r: LessonRecord | undefined): CompletedStages {
  return {
    transcript: !!r?.transcriptPath,
    content: !!r?.contentMarkdown,
    summary: !!r?.summary,
    translation: !!r?.translation,
  };
}

/** Estados finais: partial já gerou arquivo (com avisos) e não é refeito no resume. */
const TERMINAL: LessonStatus[] = ["completed", "partial"];

export class ProgressRepository {
  constructor(private readonly db: Database) {}

  /** Registra a aula como pendente, ou atualiza metadados descobertos sem perder progresso. */
  upsertLesson(lesson: Lesson, now = new Date()): LessonRecord {
    this.db
      .prepare(
        `INSERT INTO lessons (id, course_id, platform, title, url, position, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url,
           position = excluded.position, course_id = excluded.course_id`,
      )
      .run(lesson.id, lesson.courseId, lesson.platform, lesson.title, lesson.url, lesson.position, now.toISOString());
    return this.get(lesson.id)!;
  }

  get(id: string): LessonRecord | undefined {
    const r = this.db.prepare("SELECT * FROM lessons WHERE id = ?").get(id) as Row | undefined;
    return r && toRecord(r);
  }

  listByCourse(courseId: string): LessonRecord[] {
    return (
      this.db.prepare("SELECT * FROM lessons WHERE course_id = ? ORDER BY position").all(courseId) as unknown as Row[]
    ).map(toRecord);
  }

  /** Aulas selecionadas e ainda não finalizadas: pending, interrompidas ou com falha. */
  findResumable(courseId?: string): LessonRecord[] {
    const placeholders = TERMINAL.map(() => "?").join(",");
    const sql = `SELECT * FROM lessons WHERE status NOT IN (${placeholders})
                 ${courseId ? "AND course_id = ?" : ""} ORDER BY course_id, position`;
    const args: string[] = [...TERMINAL, ...(courseId ? [courseId] : [])];
    return (this.db.prepare(sql).all(...args) as unknown as Row[]).map(toRecord);
  }

  setStatus(id: string, status: LessonStatus, error?: string | null, now = new Date()): void {
    this.db
      .prepare("UPDATE lessons SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error === undefined ? null : error, now.toISOString(), id);
  }

  saveStage(id: string, update: StageUpdate, now = new Date()): void {
    const keys = Object.keys(update) as (keyof StageUpdate)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${COLUMN[k]} = ?`).join(", ");
    const values = keys.map((k) => {
      const v = update[k];
      if (v === null || v === undefined) return null;
      if (Array.isArray(v)) return JSON.stringify(v);
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    });
    this.db
      .prepare(`UPDATE lessons SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...values, now.toISOString(), id);
  }

  markFinished(
    id: string,
    status: Extract<LessonStatus, "completed" | "partial">,
    outputPath: string,
    now = new Date(),
  ): void {
    this.db
      .prepare(
        "UPDATE lessons SET status = ?, output_path = ?, processed_at = ?, error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(status, outputPath, now.toISOString(), now.toISOString(), id);
  }

  /** Descarta resultados intermediários para forçar reprocessamento completo. */
  reset(id: string, now = new Date()): void {
    this.db
      .prepare(
        `UPDATE lessons SET status = 'pending', error = NULL, content_hash = NULL, transcript_path = NULL,
           transcript_status = NULL, transcript_source = NULL, transcript_complete = NULL,
           transcript_warnings = NULL, content_markdown = NULL, summary = NULL, translation = NULL,
           updated_at = ? WHERE id = ?`,
      )
      .run(now.toISOString(), id);
  }
}

interface Row {
  id: string;
  course_id: string;
  platform: string;
  title: string;
  url: string;
  position: number;
  status: LessonStatus;
  processed_at: string | null;
  output_path: string | null;
  error: string | null;
  content_hash: string | null;
  transcript_path: string | null;
  transcript_status: string | null;
  transcript_source: string | null;
  transcript_complete: number | null;
  transcript_warnings: string | null;
  content_markdown: string | null;
  summary: string | null;
  translation: string | null;
  updated_at: string;
}

function toRecord(r: Row): LessonRecord {
  return {
    id: r.id,
    courseId: r.course_id,
    platform: r.platform,
    title: r.title,
    url: r.url,
    position: r.position,
    status: r.status,
    processedAt: r.processed_at ?? undefined,
    outputPath: r.output_path ?? undefined,
    error: r.error ?? undefined,
    contentHash: r.content_hash ?? undefined,
    transcriptPath: r.transcript_path ?? undefined,
    transcriptStatus: r.transcript_status ?? undefined,
    transcriptSource: r.transcript_source ?? undefined,
    transcriptComplete: r.transcript_complete === null ? undefined : r.transcript_complete === 1,
    transcriptWarnings: r.transcript_warnings ? (JSON.parse(r.transcript_warnings) as string[]) : undefined,
    contentMarkdown: r.content_markdown ?? undefined,
    summary: r.summary ?? undefined,
    translation: r.translation ?? undefined,
    updatedAt: r.updated_at,
  };
}
