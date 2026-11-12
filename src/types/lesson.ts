export interface Lesson {
  id: string;
  platform: string;
  courseId: string;
  title: string;
  url: string;
  /** Posição na lista descoberta, começando em 1. */
  position: number;
}

export interface LessonContentResult {
  html: string;
  extractedAt: Date;
  source: string;
}

export type LessonStatus =
  | "pending"
  | "extracting"
  | "transcript_extracted"
  | "content_extracted"
  | "summarizing"
  | "translating"
  | "completed"
  | "partial"
  | "failed";
