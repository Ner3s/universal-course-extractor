import type {
  CoursePlatformAdapter,
  PlatformContext,
} from "../../src/platforms/contracts/index.js";
import type { Course, Lesson } from "../../src/types/index.js";

export class FakeAdapter implements CoursePlatformAdapter {
  initialized = false;
  constructor(
    readonly name: string,
    private readonly host: string,
  ) {}

  async canHandle(url: string) {
    try {
      return new URL(url).hostname === this.host;
    } catch {
      return false;
    }
  }
  async initialize(_c: PlatformContext) {
    this.initialized = true;
  }
  async authenticate() {
    return { authenticated: true };
  }
  private lessons(courseUrl: string): Lesson[] {
    return [1, 2, 3].map((position) => ({
      id: `${this.name}-${position}`,
      platform: this.name,
      courseId: "c1",
      title: `Aula ${position}`,
      url: `${courseUrl}/${position}`,
      position,
    }));
  }
  async getCourses(): Promise<Course[]> {
    const url = `https://${this.host}/course`;
    return [
      { id: "c1", platform: this.name, title: "Curso", url, lessons: this.lessons(url) },
    ];
  }
  async getLessons(courseUrl: string) {
    return this.lessons(courseUrl);
  }
  async getLessonContent(_l: Lesson) {
    return { html: "<p>x</p>", extractedAt: new Date(), source: "fake" };
  }
  async getTranscript(_l: Lesson) {
    return { status: "unavailable" as const, reason: "fake" };
  }
  async dispose() {
    this.initialized = false;
  }
}
