import type { TranscriptResult } from "../../types/index.js";
import {
  assessCoverage,
  normalizeSegments,
  segmentsToText,
} from "../transcript-integrity.js";
import {
  cuesToSegments,
  pickBestTrack,
  type VideoTracksSnapshot,
} from "../text-tracks.js";

/** Converte um snapshot de faixas em TranscriptResult com avaliação de completude. */
export function snapshotToResult(
  snapshot: VideoTracksSnapshot,
  source: "text-track" | "captions",
  extraWarnings: string[] = [],
): TranscriptResult | null {
  const track = pickBestTrack(snapshot.tracks);
  if (!track) return null;
  const segments = normalizeSegments(cuesToSegments(track.cues));
  if (segments.length === 0) return null;
  const report = assessCoverage(segments, snapshot.duration);
  const data = {
    text: segmentsToText(segments),
    language: track.language || undefined,
    segments,
    source,
    complete: report.complete,
    metadata: {
      trackKind: track.kind,
      trackLabel: track.label,
      durationSeconds: snapshot.duration,
      coverage: report.coverage,
      availableTracks: snapshot.tracks.map((t) => ({
        kind: t.kind,
        label: t.label,
        language: t.language,
        cues: t.cues.length,
      })),
    },
    warnings: [...extraWarnings, ...report.warnings],
  };
  return report.complete ? { status: "found", ...data } : { status: "partial", ...data };
}
