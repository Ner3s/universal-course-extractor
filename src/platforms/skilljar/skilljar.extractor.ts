import type { Page } from "playwright";
import type { Logger } from "pino";
import type { LessonContentResult } from "../../types/index.js";
import type { SkilljarSelectors } from "./skilljar.selectors.js";

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

  /** Extrai o HTML completo (não innerText) do elemento de conteúdo (§9.3). */
  async getContentHtml(url: string): Promise<LessonContentResult> {
    await this.openLesson(url);
    const sel = this.selectors.lesson_content;
    const el = this.page.locator(sel).first();
    try {
      await el.waitFor({ state: "attached" });
    } catch {
      this.logger.error({ selector: sel, url }, "Lesson content selector not found");
      throw new Error(`Lesson content selector "${sel}" not found at ${url}`);
    }
    const html = await el.innerHTML();
    return { html, extractedAt: new Date(), source: `selector:${sel}` };
  }
}
