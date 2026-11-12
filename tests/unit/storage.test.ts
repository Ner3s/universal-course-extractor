import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, type Database } from "../../src/storage/database.js";
import { CourseRepository } from "../../src/storage/repositories/course.repository.js";
import { ProgressRepository, detectCompletedStages } from "../../src/storage/repositories/progress.repository.js";
import type { Lesson } from "../../src/types/index.js";

const course = { id: "h/c", platform: "skilljar", title: "Curso", url: "https://h/c" };
const lesson = (n: number): Lesson => ({
  id: `h/c/l${n}`, platform: "skilljar", courseId: "h/c", title: `Aula ${n}`, url: `https://h/c/l${n}`, position: n,
});

let db: Database;
let courses: CourseRepository;
let progress: ProgressRepository;
beforeEach(() => {
  db = openDatabase(":memory:");
  courses = new CourseRepository(db);
  progress = new ProgressRepository(db);
  courses.upsert(course, new Date("2026-01-01"));
});

describe("CourseRepository", () => {
  it("preserva a data de descoberta e atualiza título", () => {
    courses.upsert({ ...course, title: "Novo" }, new Date("2026-06-01"));
    const c = courses.get("h/c")!;
    expect(c.title).toBe("Novo");
    expect(c.discoveredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(courses.findByTitle("novo")?.id).toBe("h/c");
    expect(courses.list()).toHaveLength(1);
  });
});

describe("ProgressRepository", () => {
  it("registra aula como pending e preserva progresso em upserts", () => {
    progress.upsertLesson(lesson(1));
    progress.setStatus("h/c/l1", "translating");
    progress.saveStage("h/c/l1", { summary: "S" });
    const r = progress.upsertLesson({ ...lesson(1), title: "Renomeada" });
    expect(r.title).toBe("Renomeada");
    expect(r.status).toBe("translating");
    expect(r.summary).toBe("S");
  });

  it("grava e lê etapas com tipos corretos", () => {
    progress.upsertLesson(lesson(1));
    progress.saveStage("h/c/l1", {
      transcriptPath: "/t.txt", transcriptStatus: "partial", transcriptSource: "text-track",
      transcriptComplete: false, transcriptWarnings: ["a", "b"], contentHash: "abc", contentMarkdown: "# x",
    });
    const r = progress.get("h/c/l1")!;
    expect(r.transcriptComplete).toBe(false);
    expect(r.transcriptWarnings).toEqual(["a", "b"]);
    expect(r.contentHash).toBe("abc");
    progress.saveStage("h/c/l1", { transcriptWarnings: null });
    expect(progress.get("h/c/l1")!.transcriptWarnings).toBeUndefined();
  });

  it("detecta etapas concluídas", () => {
    expect(detectCompletedStages(undefined)).toEqual({ transcript: false, content: false, summary: false, translation: false });
    progress.upsertLesson(lesson(1));
    progress.saveStage("h/c/l1", { transcriptPath: "/t", summary: "s" });
    expect(detectCompletedStages(progress.get("h/c/l1"))).toEqual({
      transcript: true, content: false, summary: true, translation: false,
    });
  });

  it("registra falhas e lista aulas retomáveis (pending, em andamento e falhas; exclui completed e partial)", () => {
    for (const n of [1, 2, 3, 4]) progress.upsertLesson(lesson(n));
    progress.setStatus("h/c/l1", "failed", "boom");
    progress.setStatus("h/c/l2", "translating");
    progress.markFinished("h/c/l3", "completed", "/out/03.md");
    progress.upsertLesson(lesson(5));
    progress.markFinished("h/c/l5", "partial", "/out/05.md");
    const ids = progress.findResumable("h/c").map((r) => r.id);
    expect(ids).toEqual(["h/c/l1", "h/c/l2", "h/c/l4"]);
    expect(progress.get("h/c/l1")!.error).toBe("boom");
    expect(progress.get("h/c/l3")).toMatchObject({ status: "completed", outputPath: "/out/03.md", error: undefined });
    expect(progress.get("h/c/l3")!.processedAt).toBeDefined();
  });

  it("reset limpa etapas intermediárias", () => {
    progress.upsertLesson(lesson(1));
    progress.saveStage("h/c/l1", { summary: "s", translation: "t", transcriptPath: "/x" });
    progress.setStatus("h/c/l1", "failed", "e");
    progress.reset("h/c/l1");
    const r = progress.get("h/c/l1")!;
    expect(r.status).toBe("pending");
    expect(detectCompletedStages(r)).toEqual({ transcript: false, content: false, summary: false, translation: false });
  });

  it("lista por curso na ordem das posições", () => {
    for (const n of [3, 1, 2]) progress.upsertLesson(lesson(n));
    expect(progress.listByCourse("h/c").map((l) => l.position)).toEqual([1, 2, 3]);
  });

  it("exige curso existente (chave estrangeira)", () => {
    expect(() => progress.upsertLesson({ ...lesson(1), courseId: "nope" })).toThrow();
  });
});
