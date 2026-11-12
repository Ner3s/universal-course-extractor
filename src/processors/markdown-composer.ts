import { stringify } from "yaml";
import type { TranscriptResult } from "../types/index.js";

export interface ComposeInput {
  title: string;
  platform: string;
  courseTitle: string;
  lessonId: string;
  position: number;
  sourceUrl: string;
  /** Resumo em Markdown (ou undefined se não houver transcrição utilizável). */
  summary?: string;
  /** Transcrição completa limpa para exibir em bloco recolhível do Obsidian. */
  transcriptText?: string;
  transcript: Pick<TranscriptResult, "status"> & {
    source?: string;
    complete?: boolean;
    warnings?: string[];
    noVideo?: boolean;
  };
  /** Conteúdo traduzido (Markdown). */
  translatedContent: string;
  generatedAt?: Date;
}

/** Aumenta o nível dos títulos em `by` (máx. 6), ignorando blocos de código. */
export function demoteHeadings(markdown: string, by: number): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1]![0]!;
        else if (f[1]![0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      const m = /^(#{1,6})(\s.*)$/.exec(line);
      if (!m) return line;
      return `${"#".repeat(Math.min(6, m[1]!.length + by))}${m[2]}`;
    })
    .join("\n");
}

/** Formata a transcrição completa em um callout recolhível do Obsidian (`> [!note]- Transcrição completa`). */
export function formatCollapsibleTranscript(text: string): string {
  const lines = text
    .trim()
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"));
  return ["> [!note]- Transcrição completa", ...lines].join("\n");
}

function summarySection(input: ComposeInput): string {
  const t = input.transcript;
  const notes: string[] = [];
  if (!input.summary) {
    if (t.noVideo) {
      return "_Aula somente textual (sem vídeo)._";
    }
    const why =
      t.status === "unavailable"
        ? "Nenhuma transcrição ou legenda acessível foi encontrada para esta aula."
        : t.status === "needs-speech-recognition"
          ? "Não há transcrição acessível; seria necessário reconhecimento de fala (não implementado)."
          : "A extração da transcrição falhou.";
    notes.push(`> [!warning] Resumo indisponível\n> ${why}`);
  } else {
    if (t.status === "partial" || t.complete === false) {
      const details = t.warnings?.length ? ` Motivos: ${t.warnings.join("; ")}.` : "";
      notes.push(
        `> [!warning] Transcrição possivelmente incompleta\n> O resumo foi gerado a partir de uma transcrição que não pôde ser verificada como completa.${details}`,
      );
    }
    notes.push(input.summary.trim());
  }

  if (input.transcriptText?.trim()) {
    notes.push(formatCollapsibleTranscript(input.transcriptText));
  }

  return notes.join("\n\n");
}

/** Monta o arquivo final no formato do §13.1 com frontmatter YAML. */
export function composeMarkdown(input: ComposeInput): string {
  const front = stringify({
    title: input.title,
    platform: input.platform,
    course: input.courseTitle,
    lesson_id: input.lessonId,
    position: input.position,
    source_url: input.sourceUrl,
    transcript_status: input.transcript.status,
    transcript_source: input.transcript.source ?? null,
    transcript_complete: input.transcript.complete ?? false,
    language: "pt-BR",
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    tags: ["curso", input.platform],
  }).trimEnd();

  const rawContent = input.translatedContent.trim();
  const content = rawContent
    ? demoteHeadings(rawContent, 2)
    : "_Esta aula contém apenas vídeo (sem material textual adicional na página)._";

  return (
    [
      `---\n${front}\n---`,
      `# ${input.title}`,
      `## Resumo da transcrição`,
      summarySection(input),
      `---`,
      `## Conteúdo da aula`,
      content,
    ].join("\n\n") + "\n"
  );
}

/** Extrai o lesson_id do frontmatter de um arquivo existente (identidade da aula). */
export function readLessonIdFromMarkdown(markdown: string): string | undefined {
  const m = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!m) return undefined;
  const id = /^lesson_id:\s*(.+)$/m.exec(m[1]!);
  return id?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}
