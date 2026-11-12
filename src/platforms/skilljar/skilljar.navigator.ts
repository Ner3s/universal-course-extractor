import type { Page } from "playwright";
import type { Logger } from "pino";
import type { Lesson } from "../../types/index.js";
import type { SkilljarSelectors } from "./skilljar.selectors.js";

/** Normaliza, valida e deduplica URLs preservando a ordem (§9.1). */
export function normalizeLessonUrls(hrefs: string[], base: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const href of hrefs) {
    if (!href.trim()) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    const s = u.toString();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function courseIdFromUrl(courseUrl: string): string {
  const u = new URL(courseUrl);
  return `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
}

export function lessonIdFromUrl(lessonUrl: string): string {
  const u = new URL(lessonUrl);
  return `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
}

export class SkilljarNavigator {
  constructor(
    private readonly page: Page,
    private readonly selectors: SkilljarSelectors,
    private readonly logger: Logger,
  ) {}

  async getCourseTitle(courseUrl: string): Promise<string> {
    await this.page.goto(courseUrl, { waitUntil: "domcontentloaded" });
    const sel = this.selectors.course_title;
    if (sel) {
      const t = await this.page.locator(sel).first().textContent().catch(() => null);
      if (t?.trim()) return t.trim();
    }
    return (await this.page.title()).trim() || courseUrl;
  }

  async getLessons(courseUrl: string, platform: string): Promise<Lesson[]> {
    await this.page.goto(courseUrl, { waitUntil: "domcontentloaded" });
    const sel = this.selectors.lesson_links;
    try {
      await this.page.waitForSelector(sel, { state: "attached" });
    } catch {
      this.logger.error({ selector: sel, url: courseUrl }, "Lesson list selector not found");
      throw new Error(
        `Lesson links selector ${sel} not found at ${courseUrl}. Configure an alternative in platforms.yaml (selectors.lesson_links).`,
      );
    }
    const items = await this.page.$$eval(sel, (as) =>
      as.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
      })),
    );
    const urls = normalizeLessonUrls(items.map((i) => i.href), courseUrl);
    const titleByUrl = new Map<string, string>();
    for (const i of items) {
      const [n] = normalizeLessonUrls([i.href], courseUrl);
      if (n && !titleByUrl.has(n)) titleByUrl.set(n, i.text);
    }
    const courseId = courseIdFromUrl(courseUrl);
    return urls.map((url, idx) => ({
      id: lessonIdFromUrl(url),
      platform,
      courseId,
      title: titleByUrl.get(url) || `Lesson ${idx + 1}`,
      url,
      position: idx + 1,
    }));
  }
}
