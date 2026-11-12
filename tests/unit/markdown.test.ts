import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { htmlToMarkdown } from "../../src/processors/html-to-markdown.js";
import {
  composeMarkdown,
  demoteHeadings,
  readLessonIdFromMarkdown,
} from "../../src/processors/markdown-composer.js";
import { buildFileNames, resolveOutputDir, toSlug } from "../../src/processors/file-naming.js";
import { MarkdownWriter } from "../../src/storage/writers/markdown-writer.js";

const html = readFileSync("tests/fixtures/skilljar-lesson.html", "utf8");

describe("htmlToMarkdown", () => {
  const { markdown, warnings } = htmlToMarkdown(html);
  it("preserva títulos, ênfase, links e listas", () => {
    expect(markdown).toContain("## Introduction to Claude");
    expect(markdown).toContain("**AI assistant**");
    expect(markdown).toContain("*helpful*");
    expect(markdown).toContain("[Anthropic](https://www.anthropic.com/claude)");
    expect(markdown).toMatch(/^-\s+Item one$/m);
    expect(markdown).toMatch(/^1\.\s+First$/m);
  });
  it("preserva código inline e blocos com linguagem", () => {
    expect(markdown).toContain("`inline_code()`");
    expect(markdown).toContain('```python\ndef hello():\n    print("hi")\n```');
  });
  it("preserva citações, separadores, tabelas e imagens com alt", () => {
    expect(markdown).toContain("> A quoted remark.");
    expect(markdown).toMatch(/^---$/m);
    expect(markdown).toContain("| Model | Use |");
    expect(markdown).toContain("| Haiku | Fast |");
    expect(markdown).toContain("![Architecture diagram](https://example.com/diagram.png)");
  });
  it("remove conteúdo perigoso e reporta o que foi removido", () => {
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("evil.example.com");
    expect(markdown).not.toContain("javascript:");
    expect(markdown).toContain("bad link");
    expect(warnings.join()).toMatch(/script/);
    expect(warnings.join()).toMatch(/iframe/);
  });
  it("avisa quando o resultado é vazio", () => {
    expect(htmlToMarkdown("<script>x</script>").warnings.join()).toMatch(/empty/);
  });
});

describe("file naming", () => {
  it("gera slugs sem acentos nem caracteres inválidos", () => {
    expect(toSlug("Introdução ao Curso: O Começo!")).toBe("introducao-ao-curso-o-comeco");
    expect(toSlug("???")).toBe("aula");
    expect(toSlug("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it("prefixa pela posição original com 2+ dígitos", () => {
    const m = buildFileNames([{ position: 3, title: "Third" }, { position: 1, title: "First" }], 12);
    expect(m.get(1)).toBe("01-first.md");
    expect(m.get(3)).toBe("03-third.md");
  });
  it("usa 3 dígitos para 100+ aulas", () => {
    expect(buildFileNames([{ position: 5, title: "x" }], 120).get(5)).toBe("005-x.md");
  });
  it("garante unicidade", () => {
    const m = buildFileNames([{ position: 1, title: "A" }, { position: 1, title: "A" }], 5);
    expect(new Set(m.values()).size).toBe(m.size);
  });
  it("diretório padrão dist/<curso>", () => {
    expect(resolveOutputDir("Anthropic Partner Academy")).toBe("dist/anthropic-partner-academy");
    expect(resolveOutputDir("x", "/vault/notes")).toBe("/vault/notes");
  });
});

describe("composeMarkdown", () => {
  const base = {
    title: "Intro", platform: "skilljar", courseTitle: "Curso", lessonId: "h/c/l1",
    position: 1, sourceUrl: "https://h/c/l1",
    summary: "Visão geral.\n\n### Principais conceitos\n\n- A\n\n### Pontos importantes\n\n- B",
    transcript: { status: "found" as const, source: "text-track", complete: true },
    translatedContent: "# Título interno\n\nTexto\n\n```md\n# não mexer\n```",
  };
  it("segue o formato: título, resumo, divisor, conteúdo", () => {
    const md = composeMarkdown(base);
    const i = (s: string) => md.indexOf(s);
    expect(md.startsWith("---\n")).toBe(true);
    expect(i("# Intro")).toBeLessThan(i("## Resumo da transcrição"));
    expect(i("## Resumo da transcrição")).toBeLessThan(i("\n---\n\n## Conteúdo da aula"));
    expect(md).toContain("### Principais conceitos");
    expect(md).toContain("title: Intro");
    expect(md).toContain("lesson_id: h/c/l1");
  });
  it("rebaixa títulos do conteúdo sem tocar em código", () => {
    const md = composeMarkdown(base);
    expect(md).toContain("### Título interno");
    expect(md).toContain("```md\n# não mexer\n```");
    expect(demoteHeadings("###### x", 2)).toBe("###### x");
  });
  it("avisa quando o resumo está indisponível ou a transcrição é parcial", () => {
    expect(composeMarkdown({ ...base, summary: undefined, transcript: { status: "unavailable" } })).toContain("Resumo indisponível");
    const partial = composeMarkdown({ ...base, transcript: { status: "partial", complete: false, warnings: ["gap"] } });
    expect(partial).toContain("possivelmente incompleta");
    expect(partial).toContain("gap");
  });
  it("inclui bloco recolhível '> [!note]- Transcrição completa' quando transcriptText está presente", () => {
    const md = composeMarkdown({
      ...base,
      transcriptText: "Primeiro parágrafo da aula.\n\nSegundo parágrafo da aula.",
    });
    expect(md).toContain("> [!note]- Transcrição completa\n> Primeiro parágrafo da aula.\n>\n> Segundo parágrafo da aula.");
  });
  it("formata adequadamente aulas só com vídeo e aulas só de texto", () => {
    const videoOnly = composeMarkdown({ ...base, translatedContent: "" });
    expect(videoOnly).toContain("_Esta aula contém apenas vídeo (sem material textual adicional na página)._");
    const textOnly = composeMarkdown({
      ...base,
      summary: undefined,
      transcript: { status: "unavailable", complete: true, noVideo: true },
    });
    expect(textOnly).toContain("_Aula somente textual (sem vídeo)._");
    expect(textOnly).not.toContain("Resumo indisponível");
  });
  it("lê lesson_id do frontmatter", () => {
    expect(readLessonIdFromMarkdown(composeMarkdown(base))).toBe("h/c/l1");
    expect(readLessonIdFromMarkdown("no frontmatter")).toBeUndefined();
  });
});

describe("MarkdownWriter", () => {
  const req = (dir: string, content = "new", lessonId = "L1") => ({ dir, fileName: "01-a.md", content, lessonId });

  it("escreve arquivo novo criando diretórios e sem restos temporários", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "w-")), "sub", "dir");
    const r = await new MarkdownWriter("ask", async () => "skip").write(req(dir));
    expect(r).toMatchObject({ status: "written", overwritten: false });
    expect(await readdir(dir)).toEqual(["01-a.md"]);
  });
  it("skip mantém o arquivo existente", async () => {
    const dir = await mkdtemp(join(tmpdir(), "w-"));
    await writeFile(join(dir, "01-a.md"), "old");
    const r = await new MarkdownWriter("skip").write(req(dir));
    expect(r.status).toBe("skipped");
    expect(await readFile(join(dir, "01-a.md"), "utf8")).toBe("old");
  });
  it("overwrite substitui", async () => {
    const dir = await mkdtemp(join(tmpdir(), "w-"));
    await writeFile(join(dir, "01-a.md"), "old");
    const r = await new MarkdownWriter("overwrite").write(req(dir));
    expect(r).toMatchObject({ status: "written", overwritten: true });
    expect(await readFile(join(dir, "01-a.md"), "utf8")).toBe("new");
  });
  it("ask consulta o usuário com a identidade da aula", async () => {
    const dir = await mkdtemp(join(tmpdir(), "w-"));
    await writeFile(join(dir, "01-a.md"), "---\nlesson_id: L1\n---\nold");
    let seen: unknown;
    const w = new MarkdownWriter("ask", async (info) => {
      seen = info;
      return "skip";
    });
    expect((await w.write(req(dir))).status).toBe("skipped");
    expect(seen).toMatchObject({ existingLessonId: "L1", sameLesson: true });
    const w2 = new MarkdownWriter("ask", async () => "overwrite");
    expect((await w2.write(req(dir, "newer"))).status).toBe("written");
  });
  it("policy ask exige resolvedor", () => {
    expect(() => new MarkdownWriter("ask")).toThrow();
  });
});
