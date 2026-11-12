import type { LessonOutcome, ProgressEvent } from "../core/lesson-processor.js";
import type { Lesson } from "../types/index.js";
import type { RunSummary } from "../core/course-runner.js";

const LABEL: Record<ProgressEvent["step"], { start: string; done: string }> = {
  transcript: { start: "Extracting transcript...", done: "Transcript extracted" },
  content: { start: "Extracting content...", done: "Content extracted" },
  summary: { start: "Generating summary...", done: "Summary generated" },
  translation: { start: "Translating content...", done: "Content translated" },
  write: { start: "Saving Markdown...", done: "Markdown saved" },
};

export function formatEvent(e: ProgressEvent): string {
  const l = LABEL[e.step];
  const d = e.detail ? ` (${e.detail})` : "";
  switch (e.state) {
    case "start":
      return `  [..] ${l.start}`;
    case "done":
      return `  [OK] ${l.done}${d}`;
    case "reused":
      return `  [OK] ${l.done} (reused from previous run)`;
    case "warn":
      return `  [!!] ${l.done.split(" ")[0]}: ${e.detail ?? "warning"}`;
    case "failed":
      return `  [XX] ${l.done.split(" ")[0]} failed: ${e.detail ?? "error"}`;
  }
}

export function formatLessonHeader(lesson: Lesson, index: number, total: number): string {
  return `\n[${index + 1}/${total}] ${lesson.title}`;
}

export function formatSummary(s: RunSummary, done: number): string {
  const lines = [
    "",
    `Progress: ${s.completed + s.partial}/${s.total} lessons written` +
      (s.skipped ? `, ${s.skipped} skipped` : "") +
      (s.failed ? `, ${s.failed} failed` : "") +
      (s.partial ? ` (${s.partial} with warnings)` : ""),
  ];
  if (s.interrupted) lines.push(`Interrupted after ${done} lesson(s). Run "resume" to continue.`);
  for (const r of s.results) {
    if (r.outcome.status === "failed") {
      lines.push(`  Lesson ${r.lesson.position} "${r.lesson.title}" failed at ${r.outcome.stage}: ${r.outcome.error}`);
    }
  }
  if (s.failed) lines.push('Run "resume" to retry failed lessons; finished stages are reused.');
  return lines.join("\n");
}

export function describeOutcome(o: LessonOutcome): string {
  return o.status === "failed" ? `failed (${o.stage})` : o.status;
}

/** Reporter com saída injetável (stdout por padrão). */
export class ProgressReporter {
  constructor(private readonly out: (line: string) => void = (l) => console.log(l)) {}
  header(lesson: Lesson, index: number, total: number) {
    this.out(formatLessonHeader(lesson, index, total));
  }
  event(e: ProgressEvent) {
    this.out(formatEvent(e));
  }
  skipped(path: string) {
    this.out(`  [--] Skipped (already exists): ${path}`);
  }
  summary(s: RunSummary) {
    this.out(formatSummary(s, s.results.length));
  }
}
