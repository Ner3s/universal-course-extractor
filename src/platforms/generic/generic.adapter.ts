import type {
  CoursePlatformAdapter,
  PlatformContext,
} from "../contracts/course-platform-adapter.js";
import type {
  AuthenticationResult,
  Course,
  Lesson,
  LessonContentResult,
  TranscriptResult,
} from "../../types/index.js";
import { createDefaultTranscriptExtractor } from "../../extraction/default-chain.js";
import {
  SkilljarExtractor as SelectorExtractor,
} from "../skilljar/skilljar.extractor.js";
import {
  SkilljarNavigator as SelectorNavigator,
  courseIdFromUrl,
} from "../skilljar/skilljar.navigator.js";
import type { SkilljarSelectors } from "../skilljar/skilljar.selectors.js";

const REQUIRED = ["lesson_links", "lesson_content"] as const;

/**
 * EXPERIMENTAL. Funciona apenas com seletores configurados pelo usuário.
 * Reutiliza navegação/extração baseadas em seletores; não promete
 * compatibilidade universal e falha com erros claros.
 */
export class GenericAdapter implements CoursePlatformAdapter {
  readonly name = "generic";
  private ctx?: PlatformContext;
  private navigator?: SelectorNavigator;
  private extractor?: SelectorExtractor;
  private startUrl?: string;

  /** Aceita qualquer URL http(s); deve ser usado apenas como fallback no registry. */
  async canHandle(url: string): Promise<boolean> {
    try {
      const p = new URL(url).protocol;
      return p === "http:" || p === "https:";
    } catch {
      return false;
    }
  }

  async initialize(context: PlatformContext): Promise<void> {
    const sel = context.config.selectors;
    const missing = REQUIRED.filter((k) => !sel[k]?.trim());
    if (missing.length) {
      throw new Error(
        `GenericAdapter requires selectors in platforms.yaml: ${missing.join(", ")}`,
      );
    }
    const selectors: SkilljarSelectors = {
      course_title: sel.course_title ?? "",
      lesson_links: sel.lesson_links!,
      lesson_title: sel.lesson_title || "h1",
      lesson_content: sel.lesson_content!,
      video: sel.video || "video",
      logged_in: sel.logged_in ?? "",
      transcript: sel.transcript ?? "",
    };
    this.ctx = context;
    this.navigator = new SelectorNavigator(context.page, selectors, context.logger);
    this.extractor = new SelectorExtractor(context.page, selectors, context.logger);
  }

  setStartUrl(url: string): void {
    this.startUrl = url;
  }

  async authenticate(): Promise<AuthenticationResult> {
    return {
      authenticated: false,
      message: "Generic adapter has no authentication flow; reuse a saved session or use public pages.",
    };
  }

  async getCourses(): Promise<Course[]> {
    if (!this.startUrl) throw new Error("setStartUrl() must be called first");
    const lessons = await this.getLessons(this.startUrl);
    return [
      {
        id: courseIdFromUrl(this.startUrl),
        platform: this.name,
        title: await this.navigator!.getCourseTitle(this.startUrl),
        url: this.startUrl,
        lessons,
      },
    ];
  }

  getLessons(courseUrl: string): Promise<Lesson[]> {
    if (!this.navigator) throw new Error("GenericAdapter not initialized");
    return this.navigator.getLessons(courseUrl, this.name);
  }

  getLessonContent(lesson: Lesson): Promise<LessonContentResult> {
    if (!this.extractor) throw new Error("GenericAdapter not initialized");
    return this.extractor.getContentHtml(lesson.url);
  }

  async getLessonTitle(lesson: Lesson): Promise<string | undefined> {
    await this.extractor!.openLesson(lesson.url);
    return this.extractor!.getTitle();
  }

  async getTranscript(lesson: Lesson): Promise<TranscriptResult> {
    if (!this.ctx || !this.extractor) throw new Error("GenericAdapter not initialized");
    await this.extractor.openLesson(lesson.url);
    return createDefaultTranscriptExtractor().extract({
      page: this.ctx.page,
      logger: this.ctx.logger,
      selectors: { ...this.ctx.config.selectors },
    });
  }

  async dispose(): Promise<void> {
    this.ctx = undefined;
  }
}
