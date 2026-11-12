import { createInterface } from "node:readline/promises";
import type { Page } from "playwright";
import type { Logger } from "pino";
import { AuthenticationManager } from "../../browser/authentication-manager.js";
import type { BrowserManager } from "../../browser/browser-manager.js";
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
import { SkilljarExtractor } from "./skilljar.extractor.js";
import { SkilljarNavigator, courseIdFromUrl } from "./skilljar.navigator.js";
import { resolveSelectors, type SkilljarSelectors } from "./skilljar.selectors.js";

export interface SkilljarAdapterDeps {
  browserManager: BrowserManager;
  /** Substituível em testes; padrão: aguarda Enter no terminal. */
  waitForUserConfirmation?: () => Promise<void>;
}

async function waitForEnter(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Faça login no navegador e pressione Enter para continuar...");
  rl.close();
}

export class SkilljarAdapter implements CoursePlatformAdapter {
  readonly name = "skilljar";
  private ctx?: PlatformContext;
  private selectors?: SkilljarSelectors;
  private navigator?: SkilljarNavigator;
  private extractor?: SkilljarExtractor;
  private auth?: AuthenticationManager;
  private startUrl?: string;

  constructor(
    private readonly domains: string[],
    private readonly deps: SkilljarAdapterDeps,
  ) {}

  async canHandle(url: string): Promise<boolean> {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return this.domains.some((d) => host === d.toLowerCase());
    } catch {
      return false;
    }
  }

  async initialize(context: PlatformContext): Promise<void> {
    this.ctx = context;
    this.selectors = resolveSelectors(context.config);
    this.navigator = new SkilljarNavigator(context.page, this.selectors, context.logger);
    this.extractor = new SkilljarExtractor(context.page, this.selectors, context.logger);
    this.auth = new AuthenticationManager(this.deps.browserManager, context.logger);
  }

  private get c(): PlatformContext {
    if (!this.ctx) throw new Error("SkilljarAdapter not initialized");
    return this.ctx;
  }

  setStartUrl(url: string): void {
    this.startUrl = url;
  }

  private async isAuthenticated(page: Page): Promise<boolean> {
    const sel = this.selectors!.logged_in;
    if (sel) return (await page.locator(sel).count()) > 0;
    // Sem seletor configurado não inventamos heurística: redirecionamento
    // para páginas de login é o único sinal negativo confiável.
    return !/\/(auth|login|sign[_-]?in)\b/i.test(new URL(page.url()).pathname);
  }

  async authenticate(): Promise<AuthenticationResult> {
    if (!this.startUrl) throw new Error("setStartUrl() must be called before authenticate()");
    return this.auth!.authenticateManually(this.c.page, {
      startUrl: this.startUrl,
      isAuthenticated: (p) => this.isAuthenticated(p),
      waitForUserConfirmation: this.deps.waitForUserConfirmation ?? waitForEnter,
    });
  }

  /**
   * Skilljar não tem seletor de catálogo conhecido (§9 não fornece um);
   * retorna apenas o curso da URL inicial.
   */
  async getCourses(): Promise<Course[]> {
    if (!this.startUrl) throw new Error("setStartUrl() must be called first");
    const title = await this.navigator!.getCourseTitle(this.startUrl);
    const lessons = await this.getLessons(this.startUrl);
    return [
      {
        id: courseIdFromUrl(this.startUrl),
        platform: this.name,
        title,
        url: this.startUrl,
        lessons,
      },
    ];
  }

  getLessons(courseUrl: string): Promise<Lesson[]> {
    return this.navigator!.getLessons(courseUrl, this.name);
  }

  async getLessonContent(lesson: Lesson): Promise<LessonContentResult> {
    return this.extractor!.getContentHtml(lesson.url);
  }

  async getLessonTitle(lesson: Lesson): Promise<string | undefined> {
    await this.extractor!.openLesson(lesson.url);
    return this.extractor!.getTitle();
  }

  async getTranscript(_lesson: Lesson): Promise<TranscriptResult> {
    return { status: "unavailable", reason: "Transcript engine not wired yet" };
  }

  async dispose(): Promise<void> {
    this.ctx = undefined;
  }
}

export type { Logger };
