import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Lesson, TranscriptResult } from "../types/index.js";

export function safeFileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "lesson";
}

/** Salva a transcrição original para auditoria/reprocessamento (§10.5, §13.4). */
export class TranscriptStore {
  constructor(private readonly baseDir: string) {}

  pathFor(lesson: Pick<Lesson, "platform" | "id">): string {
    return join(this.baseDir, safeFileId(lesson.platform), `${safeFileId(lesson.id)}.txt`);
  }

  async save(lesson: Lesson, result: TranscriptResult): Promise<string | undefined> {
    if (result.status !== "found" && result.status !== "partial") return undefined;
    const file = this.pathFor(lesson);
    await mkdir(join(this.baseDir, safeFileId(lesson.platform)), { recursive: true });
    await writeFile(file, result.text, "utf8");
    const { text: _text, segments: _segments, ...meta } = result;
    await writeFile(
      file.replace(/\.txt$/, ".meta.json"),
      JSON.stringify({ lessonUrl: lesson.url, ...meta, savedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    if (result.segments) {
      await writeFile(file.replace(/\.txt$/, ".segments.json"), JSON.stringify(result.segments), "utf8");
    }
    return file;
  }
}
