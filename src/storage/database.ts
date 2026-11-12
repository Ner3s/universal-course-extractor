import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    discovered_at TEXT NOT NULL
  );
  CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    processed_at TEXT,
    output_path TEXT,
    error TEXT,
    content_hash TEXT,
    transcript_path TEXT,
    transcript_status TEXT,
    transcript_source TEXT,
    transcript_complete INTEGER,
    transcript_warnings TEXT,
    content_markdown TEXT,
    summary TEXT,
    translation TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_lessons_course ON lessons(course_id, position);
  CREATE INDEX idx_lessons_status ON lessons(status);
  `,
];

/** Abre (ou cria) o banco e aplica migrações pendentes via PRAGMA user_version. */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}
