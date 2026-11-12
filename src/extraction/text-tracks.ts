import type { Page } from "playwright";
import type { TranscriptSegment } from "../types/index.js";

export interface RawTrackInfo {
  kind: string;
  label: string;
  language: string;
  mode: string;
  cues: Array<{ start: number; end: number; text: string }>;
}

export interface VideoTracksSnapshot {
  duration?: number;
  tracks: RawTrackInfo[];
}

/**
 * Lê as faixas de texto do <video> via API padrão `video.textTracks`.
 * Faixas desabilitadas são colocadas em "hidden" (carrega cues sem exibir)
 * e aguardadas por até `waitMs`. Só leitura de dados; nenhum script externo.
 */
export async function readVideoTextTracks(
  page: Page,
  videoSelector: string,
  waitMs = 3000,
): Promise<VideoTracksSnapshot | null> {
  const has = await page.locator(videoSelector).count();
  if (has === 0) return null;
  return page.evaluate(
    async ({ sel, wait }) => {
      const video = document.querySelector(sel) as HTMLVideoElement | null;
      if (!video) return null;
      const list = Array.from(video.textTracks).filter(
        (t) => t.kind === "subtitles" || t.kind === "captions",
      );
      for (const t of list) {
        if (t.mode === "disabled") t.mode = "hidden";
      }
      const deadline = Date.now() + wait;
      while (Date.now() < deadline && list.every((t) => !t.cues || t.cues.length === 0)) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return {
        duration: Number.isFinite(video.duration) ? video.duration : undefined,
        tracks: list.map((t) => ({
          kind: t.kind,
          label: t.label,
          language: t.language,
          mode: t.mode,
          cues: Array.from(t.cues ?? []).map((c) => ({
            start: c.startTime,
            end: c.endTime,
            text: (c as VTTCue).text ?? "",
          })),
        })),
      };
    },
    { sel: videoSelector, wait: waitMs },
  );
}

/** Remove marcação WebVTT inline (<c>, <i>, <00:00:01.000>) do texto do cue. */
export function stripCueMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export function cuesToSegments(cues: RawTrackInfo["cues"]): TranscriptSegment[] {
  return cues.map((c) => ({ start: c.start, end: c.end, text: stripCueMarkup(c.text) }));
}

/** Escolhe a melhor faixa: com mais cues; empate favorece o idioma preferido. */
export function pickBestTrack(tracks: RawTrackInfo[], preferredLanguage = "en"): RawTrackInfo | undefined {
  const withCues = tracks.filter((t) => t.cues.length > 0);
  return [...withCues].sort((a, b) => {
    const pa = a.language.toLowerCase().startsWith(preferredLanguage) ? 1 : 0;
    const pb = b.language.toLowerCase().startsWith(preferredLanguage) ? 1 : 0;
    return b.cues.length - a.cues.length || pb - pa;
  })[0];
}
