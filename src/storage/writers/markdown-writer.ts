import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readLessonIdFromMarkdown } from "../../processors/markdown-composer.js";

export type ConflictPolicy = "overwrite" | "skip" | "ask";
export type ConflictDecision = "overwrite" | "skip";

export interface ConflictInfo {
  path: string;
  /** lesson_id do arquivo existente (se legível). */
  existingLessonId?: string;
  /** lesson_id do arquivo que seria escrito. */
  incomingLessonId: string;
  sameLesson: boolean;
}

export interface WriteRequest {
  dir: string;
  fileName: string;
  content: string;
  lessonId: string;
}

export type WriteResult =
  | { status: "written"; path: string; overwritten: boolean }
  | { status: "skipped"; path: string };

export class MarkdownWriter {
  constructor(
    private readonly policy: ConflictPolicy,
    /** Obrigatório quando policy = "ask". */
    private readonly resolveConflict?: (info: ConflictInfo) => Promise<ConflictDecision>,
  ) {
    if (policy === "ask" && !resolveConflict) {
      throw new Error("policy 'ask' requires a conflict resolver");
    }
  }

  exists(dir: string, fileName: string): boolean {
    return existsSync(join(dir, fileName));
  }

  /** Nunca sobrescreve silenciosamente (§17). */
  async write(req: WriteRequest): Promise<WriteResult> {
    const path = join(req.dir, req.fileName);
    let overwritten = false;
    if (existsSync(path)) {
      let existingLessonId: string | undefined;
      try {
        existingLessonId = readLessonIdFromMarkdown(await readFile(path, "utf8"));
      } catch {
        // arquivo ilegível: tratado como identidade desconhecida
      }
      const info: ConflictInfo = {
        path,
        existingLessonId,
        incomingLessonId: req.lessonId,
        sameLesson: existingLessonId === req.lessonId,
      };
      const decision: ConflictDecision =
        this.policy === "ask" ? await this.resolveConflict!(info) : this.policy;
      if (decision === "skip") return { status: "skipped", path };
      overwritten = true;
    }
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    try {
      await writeFile(tmp, req.content, "utf8");
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return { status: "written", path, overwritten };
  }
}
