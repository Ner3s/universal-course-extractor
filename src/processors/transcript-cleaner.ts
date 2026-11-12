import type { TranscriptSegment } from "../types/index.js";

const NOISE = /\[(?:music|applause|laughter|silence|inaudible|música|aplausos)\]/gi;

/** Limpa uma transcrição para o resumo: ruído, espaços e repetições de legendas automáticas. */
export function cleanTranscript(input: string | TranscriptSegment[]): string {
  const lines = typeof input === "string" ? input.split(/\r?\n/) : input.map((s) => s.text);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(NOISE, " ").replace(/>>\s*/g, "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (out[out.length - 1] === line) continue;
    out.push(line);
  }
  // Junta linhas de legenda em parágrafos: quebra após pontuação final a cada ~5 sentenças.
  const paragraphs: string[] = [];
  let current: string[] = [];
  let sentences = 0;
  for (const line of out) {
    current.push(line);
    sentences += (line.match(/[.!?](\s|$)/g) ?? []).length;
    if (sentences >= 5 && /[.!?]$/.test(line)) {
      paragraphs.push(current.join(" "));
      current = [];
      sentences = 0;
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n");
}
