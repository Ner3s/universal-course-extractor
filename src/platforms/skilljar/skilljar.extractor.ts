import type { Page } from "playwright";
import type { Logger } from "pino";
import type { LessonContentResult } from "../../types/index.js";
import type { SkilljarSelectors } from "./skilljar.selectors.js";

const FALLBACK_TEXT_SELECTORS = [
  "sjwc-lesson-content-item.course-text-content",
  ".course-text-content",
  "#lesson-main-content .lesson-description-content",
];

const LESSON_SHELL_SELECTOR =
  "sjwc-video, [id^='botr_'][id$='_div'], .course-fixed-content-video, .video-player, video, .lesson-top";

export class SkilljarExtractor {
  constructor(
    private readonly page: Page,
    private readonly selectors: SkilljarSelectors,
    private readonly logger: Logger,
  ) {}

  async openLesson(url: string): Promise<void> {
    if (this.page.url() !== url) {
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
    }
  }

  async getTitle(): Promise<string | undefined> {
    const t = await this.page
      .locator(this.selectors.lesson_title)
      .first()
      .textContent({ timeout: 10_000 })
      .catch(() => null);
    return t?.replace(/\s+/g, " ").trim() || undefined;
  }

  /**
   * Extrai o HTML completo (não innerText) do elemento de conteúdo (§9.3).
   * Suporta aulas mistas (`#details-pane-summary-content`), aulas somente de texto
   * (`.course-text-content`) e aulas somente de vídeo (retorna `html: ""` sem falhar).
   */
  async getContentHtml(url: string): Promise<LessonContentResult> {
    await this.openLesson(url);
    const sel = this.selectors.lesson_content;
    const primary = this.page.locator(sel);

    if ((await primary.count().catch(() => 0)) > 0) {
      const html = await primary.first().innerHTML();
      return { html, extractedAt: new Date(), source: `selector:${sel}` };
    }

    // Tenta seletores alternativos para aulas somente de texto/guia (ex.: .course-text-content)
    for (const alt of FALLBACK_TEXT_SELECTORS) {
      const loc = this.page.locator(alt);
      if ((await loc.count().catch(() => 0)) > 0) {
        const html = await loc.first().innerHTML();
        if (html.trim()) {
          this.logger.info({ selector: alt, url }, "Extracted lesson content using fallback text selector");
          return { html, extractedAt: new Date(), source: `selector:${alt}` };
        }
      }
    }

    // Se a página é uma aula válida somente de vídeo (sem painel de texto escrito), retorna vazio sem erro
    const hasLessonShell = (await this.page.locator(LESSON_SHELL_SELECTOR).count().catch(() => 0)) > 0;
    if (hasLessonShell) {
      this.logger.info({ url }, "Lesson has no written text pane (video-only lesson)");
      return { html: "", extractedAt: new Date(), source: "video-only" };
    }

    // Última tentativa aguardando o seletor principal antes de reportar erro
    try {
      await primary.first().waitFor({ state: "attached", timeout: 5_000 });
      const html = await primary.first().innerHTML();
      return { html, extractedAt: new Date(), source: `selector:${sel}` };
    } catch {
      this.logger.error({ selector: sel, url }, "Lesson content selector not found");
      throw new Error(`Lesson content selector "${sel}" not found at ${url}`);
    }
  }
}
