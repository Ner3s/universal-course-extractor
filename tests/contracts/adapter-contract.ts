import { describe, it, expect } from "vitest";
import type { CoursePlatformAdapter } from "../../src/platforms/contracts/index.js";

export interface ContractOptions {
  create: () => CoursePlatformAdapter;
  supportedUrl: string;
  unsupportedUrl: string;
}

/** Suíte reutilizável: todo adapter deve cumprir o contrato comum. */
export function runAdapterContract(label: string, opts: ContractOptions) {
  describe(`adapter contract: ${label}`, () => {
    it("tem nome não vazio", () => {
      expect(opts.create().name.length).toBeGreaterThan(0);
    });
    it("identifica URLs suportadas e rejeita as demais", async () => {
      const a = opts.create();
      expect(await a.canHandle(opts.supportedUrl)).toBe(true);
      expect(await a.canHandle(opts.unsupportedUrl)).toBe(false);
    });
    it("canHandle não lança para entrada inválida", async () => {
      await expect(opts.create().canHandle("not a url")).resolves.toBe(false);
    });
    it("autentica retornando AuthenticationResult", async () => {
      const r = await opts.create().authenticate();
      expect(typeof r.authenticated).toBe("boolean");
    });
    it("descobre cursos com aulas em ordem crescente de posição a partir de 1", async () => {
      const courses = await opts.create().getCourses();
      expect(courses.length).toBeGreaterThan(0);
      for (const c of courses) {
        c.lessons.forEach((l, i) => expect(l.position).toBe(i + 1));
      }
    });
    it("getLessons preserva a ordem", async () => {
      const lessons = await opts.create().getLessons(opts.supportedUrl);
      expect(lessons.map((l) => l.position)).toEqual(lessons.map((_, i) => i + 1));
    });
    it("extrai conteúdo HTML", async () => {
      const a = opts.create();
      const [l] = await a.getLessons(opts.supportedUrl);
      const c = await a.getLessonContent(l!);
      expect(typeof c.html).toBe("string");
      expect(c.extractedAt).toBeInstanceOf(Date);
    });
    it("transcrição tem estado explícito (não string vazia)", async () => {
      const a = opts.create();
      const [l] = await a.getLessons(opts.supportedUrl);
      const t = await a.getTranscript(l!);
      expect(["found", "partial", "unavailable", "failed", "needs-speech-recognition"]).toContain(t.status);
    });
    it("dispose pode ser chamado", async () => {
      await expect(opts.create().dispose()).resolves.toBeUndefined();
    });
  });
}
