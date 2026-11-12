import type { Database } from "../database.js";
import type { Course } from "../../types/index.js";

export interface CourseRecord {
  id: string;
  platform: string;
  title: string;
  url: string;
  discoveredAt: string;
}

export class CourseRepository {
  constructor(private readonly db: Database) {}

  /** Insere ou atualiza título/URL, preservando a data de descoberta original. */
  upsert(course: Pick<Course, "id" | "platform" | "title" | "url">, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO courses (id, platform, title, url, discovered_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, platform = excluded.platform`,
      )
      .run(course.id, course.platform, course.title, course.url, now.toISOString());
  }

  get(id: string): CourseRecord | undefined {
    const r = this.db.prepare("SELECT * FROM courses WHERE id = ?").get(id) as Row | undefined;
    return r && toRecord(r);
  }

  findByTitle(title: string): CourseRecord | undefined {
    const r = this.db
      .prepare("SELECT * FROM courses WHERE lower(title) = lower(?) ORDER BY discovered_at DESC LIMIT 1")
      .get(title) as Row | undefined;
    return r && toRecord(r);
  }

  list(): CourseRecord[] {
    return (this.db.prepare("SELECT * FROM courses ORDER BY discovered_at").all() as unknown as Row[]).map(toRecord);
  }
}

interface Row {
  id: string;
  platform: string;
  title: string;
  url: string;
  discovered_at: string;
}

function toRecord(r: Row): CourseRecord {
  return { id: r.id, platform: r.platform, title: r.title, url: r.url, discoveredAt: r.discovered_at };
}
