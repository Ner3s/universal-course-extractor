import slugify from "slugify";
import { join } from "node:path";

export function toSlug(title: string, maxLength = 80): string {
  const slug = slugify(title, { lower: true, strict: true, trim: true }).slice(0, maxLength).replace(/-+$/g, "");
  return slug || "aula";
}

export function prefixWidth(maxPosition: number): number {
  return Math.max(2, String(Math.max(1, maxPosition)).length);
}

export interface NamedLesson {
  position: number;
  title: string;
}

/**
 * Nomes sequenciais baseados na posição original (preserva a ordem mesmo ao
 * processar um subconjunto). `totalLessons` define a largura do prefixo.
 * Garante unicidade.
 */
export function buildFileNames(lessons: NamedLesson[], totalLessons: number): Map<number, string> {
  const width = prefixWidth(totalLessons);
  const used = new Set<string>();
  const out = new Map<number, string>();
  for (const l of [...lessons].sort((a, b) => a.position - b.position)) {
    const base = `${String(l.position).padStart(width, "0")}-${toSlug(l.title)}`;
    let name = `${base}.md`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.md`;
    used.add(name);
    out.set(l.position, name);
  }
  return out;
}

/** Diretório padrão: dist/<curso>/ (§13.3), ou o informado pelo usuário. */
export function resolveOutputDir(courseTitle: string, userOutput?: string, defaultBase = "dist"): string {
  return userOutput ? userOutput : join(defaultBase, toSlug(courseTitle));
}
