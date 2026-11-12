import type { Lesson } from "./lesson.js";

export interface Course {
  id: string;
  platform: string;
  title: string;
  url: string;
  lessons: Lesson[];
}
