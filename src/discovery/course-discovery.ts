import { CliUsageError } from "../cli/errors.js";
import type { Course } from "../types/index.js";

/** Seleciona o curso pelo nome (exato, senão substring). Erra em ambiguidade. */
export function findCourse(courses: Course[], name: string): Course {
  const n = name.trim().toLowerCase();
  const exact = courses.filter((c) => c.title.trim().toLowerCase() === n);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length > 1 ? exact : courses.filter((c) => c.title.toLowerCase().includes(n));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) {
    throw new CliUsageError(
      `Course "${name}" not found. Available: ${courses.map((c) => `"${c.title}"`).join(", ") || "(none)"}`,
    );
  }
  throw new CliUsageError(
    `Course name "${name}" is ambiguous: ${partial.map((c) => `"${c.title}"`).join(", ")}`,
  );
}
