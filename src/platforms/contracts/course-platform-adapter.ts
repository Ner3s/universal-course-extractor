import type { Browser, Page } from "playwright";
import type { Logger } from "pino";
import type { PlatformConfig } from "../../config/config.schema.js";
import type {
  AuthenticationResult,
  Course,
  Lesson,
  LessonContentResult,
  TranscriptResult,
} from "../../types/index.js";

export interface PlatformContext {
  browser: Browser;
  page: Page;
  config: PlatformConfig;
  logger: Logger;
}

export interface CoursePlatformAdapter {
  readonly name: string;
  canHandle(url: string): Promise<boolean>;
  initialize(context: PlatformContext): Promise<void>;
  authenticate(): Promise<AuthenticationResult>;
  getCourses(): Promise<Course[]>;
  getLessons(courseUrl: string): Promise<Lesson[]>;
  getLessonContent(lesson: Lesson): Promise<LessonContentResult>;
  getTranscript(lesson: Lesson): Promise<TranscriptResult>;
  dispose(): Promise<void>;

  /** Opcionais: o núcleo usa quando presentes. */
  setStartUrl?(url: string): void;
  getLessonTitle?(lesson: Lesson): Promise<string | undefined>;
}
