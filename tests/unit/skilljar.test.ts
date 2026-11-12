import { describe, it, expect } from "vitest";
import {
  normalizeLessonUrls,
  courseIdFromUrl,
  lessonIdFromUrl,
} from "../../src/platforms/skilljar/skilljar.navigator.js";
import { resolveSelectors } from "../../src/platforms/skilljar/skilljar.selectors.js";
import { SkilljarAdapter } from "../../src/platforms/skilljar/skilljar.adapter.js";
import { parsePlatformsConfig } from "../../src/config/config.loader.js";
import { readFileSync } from "node:fs";

describe("normalizeLessonUrls", () => {
  const base = "https://anthropic-partners.skilljar.com/course";
  it("preserva ordem, remove duplicatas e hashes", () => {
    expect(
      normalizeLessonUrls(["/course/b", "/course/a", "/course/b#x", "/course/a"], base),
    ).toEqual([
      "https://anthropic-partners.skilljar.com/course/b",
      "https://anthropic-partners.skilljar.com/course/a",
    ]);
  });
  it("descarta URLs inválidas e protocolos não-http", () => {
    expect(normalizeLessonUrls(["javascript:alert(1)", "mailto:a@b.c", "", "http://"], base)).toEqual([]);
  });
});

describe("ids", () => {
  it("derivam de host+path", () => {
    expect(courseIdFromUrl("https://h.com/c/")).toBe("h.com/c");
    expect(lessonIdFromUrl("https://h.com/c/l1?x=1")).toBe("h.com/c/l1");
  });
});

describe("resolveSelectors", () => {
  const cfg = parsePlatformsConfig(readFileSync("config/platforms.example.yaml", "utf8")).platforms.skilljar!;
  it("usa os valores configurados", () => {
    expect(resolveSelectors(cfg).lesson_links).toBe("#curriculum-list-2 a");
  });
  it("mantém padrão quando o valor configurado é vazio", () => {
    expect(resolveSelectors(cfg).lesson_title).toBe(".lesson-top > h2");
    expect(resolveSelectors({ ...cfg, selectors: { lesson_title: "" } }).lesson_title).toBe(".lesson-top > h2");
  });
  it("permite sobrescrever", () => {
    expect(resolveSelectors({ ...cfg, selectors: { lesson_links: ".x a" } }).lesson_links).toBe(".x a");
  });
});

describe("SkilljarAdapter.canHandle", () => {
  const a = new SkilljarAdapter(["anthropic-partners.skilljar.com"], {} as never);
  it("identifica domínios configurados", async () => {
    expect(await a.canHandle("https://anthropic-partners.skilljar.com/x")).toBe(true);
    expect(await a.canHandle("https://udemy.com/x")).toBe(false);
    expect(await a.canHandle("nope")).toBe(false);
  });
});
