import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { chromium, type Browser } from "playwright";
import { SkilljarAdapter } from "../../src/platforms/skilljar/skilljar.adapter.js";
import { platformConfigSchema } from "../../src/config/config.schema.js";

/**
 * Integração com Chromium REAL contra HTML local (sem rede, sem login).
 * Valida seletores, extração de HTML e leitura de textTracks.
 * NÃO substitui o teste com uma aula real autorizada (ver README, "Validação ponta a ponta").
 *
 * Execução: npx playwright install chromium && npm run test:integration
 */
const VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nWelcome to the course.\n\n00:00:04.000 --> 00:00:09.000\nThis is lesson one.\n";
const vttUrl = `data:text/vtt;base64,${Buffer.from(VTT).toString("base64")}`;

const COURSE_HTML = `<html><head><title>Fixture Course</title></head><body>
<ul id="curriculum-list-2">
  <a href="/course/l1">Lesson One</a>
  <a href="/course/l2">Lesson Two</a>
  <a href="/course/l1#again">dup</a>
</ul></body></html>`;

const LESSON_HTML = `<html><body>
<div class="lesson-top"><h2>  Lesson   One </h2></div>
<video class="jw-video jw-reset" playsinline><track kind="captions" srclang="en" label="English" src="${vttUrl}" default></video>
<div id="details-pane-summary-content"><h3>Notes</h3><p>Hello <b>world</b></p><pre><code>x = 1</code></pre></div>
</body></html>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

describe("Skilljar adapter em Chromium real (fixtures locais)", () => {
  it("descobre aulas, extrai título/HTML e lê legendas", async () => {
    const context = await browser.newContext();
    await context.route("https://anthropic-partners.skilljar.com/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        contentType: "text/html",
        body: path.startsWith("/course/l") ? LESSON_HTML : COURSE_HTML,
      });
    });
    const page = await context.newPage();
    const adapter = new SkilljarAdapter(["anthropic-partners.skilljar.com"], {} as never);
    await adapter.initialize({
      browser,
      page,
      logger: pino({ level: "silent" }),
      config: platformConfigSchema.parse({
        selectors: {
          lesson_links: "#curriculum-list-2 a",
          lesson_title: ".lesson-top > h2",
          lesson_content: "#details-pane-summary-content",
          video: "video.jw-video",
        },
      }),
    });

    const lessons = await adapter.getLessons("https://anthropic-partners.skilljar.com/course");
    expect(lessons.map((l) => [l.position, l.title])).toEqual([[1, "Lesson One"], [2, "Lesson Two"]]);

    expect(await adapter.getLessonTitle(lessons[0]!)).toBe("Lesson One");

    const content = await adapter.getLessonContent(lessons[0]!);
    expect(content.html).toContain("<b>world</b>");
    expect(content.html).toContain("<pre>");

    const t = await adapter.getTranscript(lessons[0]!);
    expect(["found", "partial"]).toContain(t.status);
    if (t.status === "found" || t.status === "partial") {
      expect(t.source).toBe("text-track");
      expect(t.text).toContain("Welcome to the course.");
      // Sem duração do vídeo não há evidência de completude.
      if (!t.metadata?.durationSeconds) expect(t.complete).toBe(false);
    }
    await context.close();
  }, 60_000);

  it("falha com diagnóstico claro quando o seletor de aulas não existe", async () => {
    const context = await browser.newContext();
    await context.route("https://anthropic-partners.skilljar.com/**", (r) =>
      r.fulfill({ contentType: "text/html", body: "<html><body>empty</body></html>" }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(1500);
    const adapter = new SkilljarAdapter(["anthropic-partners.skilljar.com"], {} as never);
    await adapter.initialize({
      browser, page, logger: pino({ level: "silent" }),
      config: platformConfigSchema.parse({ browser: { headed: false, navigation_timeout: 1500 } }),
    });
    await expect(adapter.getLessons("https://anthropic-partners.skilljar.com/course")).rejects.toThrow(/selector/i);
    await context.close();
  }, 30_000);
});
