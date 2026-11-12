import type { TranscriptSegment } from "../types/index.js";

export interface CoverageReport {
  /** true somente com evidência temporal suficiente. */
  complete: boolean;
  coverage?: number;
  warnings: string[];
}

export interface CoverageOptions {
  /** Fração mínima da duração que precisa ser coberta. */
  minCoverage: number;
  /** Lacuna (s) acima da qual a transcrição é considerada com segmentos ausentes. */
  maxGapSeconds: number;
  /** Tolerância (s) para início/fim em relação à duração. */
  edgeToleranceSeconds: number;
}

export const DEFAULT_COVERAGE: CoverageOptions = {
  minCoverage: 0.9,
  maxGapSeconds: 60,
  edgeToleranceSeconds: 30,
};

/** Normaliza segmentos: trim, remove vazios e duplicatas consecutivas, ordena por início. */
export function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const cleaned = segments
    .map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text.length > 0);
  const timed = cleaned.every((s) => s.start !== undefined);
  const sorted = timed ? [...cleaned].sort((a, b) => a.start! - b.start!) : cleaned;
  const out: TranscriptSegment[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.text === s.text && prev.start === s.start) continue;
    out.push(s);
  }
  return out;
}

export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join("\n");
}

/**
 * Avalia a completude (§10.5). Sem duração do vídeo ou sem tempos nos segmentos,
 * nunca declara completa.
 */
export function assessCoverage(
  segments: TranscriptSegment[],
  durationSeconds: number | undefined,
  opts: CoverageOptions = DEFAULT_COVERAGE,
): CoverageReport {
  const warnings: string[] = [];
  if (segments.length === 0) {
    return { complete: false, coverage: 0, warnings: ["Transcript has no segments"] };
  }
  const timed = segments.filter((s) => s.start !== undefined && s.end !== undefined);
  if (timed.length !== segments.length) {
    warnings.push("Segments lack timing; completeness cannot be verified");
    return { complete: false, warnings };
  }
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    warnings.push("Video duration unknown; completeness cannot be verified");
    return { complete: false, warnings };
  }

  let largestGap = 0;
  let cursor = 0;
  for (const s of timed) {
    const start = Math.max(s.start!, cursor);
    const end = Math.max(s.end!, start);
    largestGap = Math.max(largestGap, s.start! - cursor);
    cursor = Math.max(cursor, end);
  }
  largestGap = Math.max(largestGap, durationSeconds - cursor);
  const coverage = Math.min(1, (cursor - timed[0]!.start!) / durationSeconds); // extensão temporal; pausas curtas não penalizam

  const first = timed[0]!.start!;
  if (first > opts.edgeToleranceSeconds) {
    warnings.push(`Transcript starts late (${first.toFixed(0)}s)`);
  }
  if (durationSeconds - cursor > opts.edgeToleranceSeconds) {
    warnings.push(`Transcript ends ${(durationSeconds - cursor).toFixed(0)}s before the video end`);
  }
  if (largestGap > opts.maxGapSeconds) {
    warnings.push(`Possible missing segments (gap of ${largestGap.toFixed(0)}s)`);
  }
  if (coverage < opts.minCoverage) {
    warnings.push(`Low temporal coverage (${(coverage * 100).toFixed(0)}%)`);
  }
  return { complete: warnings.length === 0, coverage, warnings };
}
