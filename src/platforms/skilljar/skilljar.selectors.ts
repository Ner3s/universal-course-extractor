import type { PlatformConfig } from "../../config/config.schema.js";

/** Valores iniciais informados pelo usuário (§9); sobrescritos pela configuração. */
export const SKILLJAR_DEFAULT_SELECTORS = {
  course_title: "",
  lesson_links: "#curriculum-list-2 a",
  lesson_title: ".lesson-top > h2",
  lesson_content: "#details-pane-summary-content",
  video: "video.jw-video",
  /** Opcional: seletor presente apenas quando autenticado. Sem valor padrão (não inventamos). */
  logged_in: "",
} as const;

export type SkilljarSelectors = Record<keyof typeof SKILLJAR_DEFAULT_SELECTORS, string>;

export function resolveSelectors(config: PlatformConfig): SkilljarSelectors {
  const out: Record<string, string> = { ...SKILLJAR_DEFAULT_SELECTORS };
  for (const [k, v] of Object.entries(config.selectors)) {
    if (k in out && v.trim() !== "") out[k] = v;
  }
  return out as SkilljarSelectors;
}
