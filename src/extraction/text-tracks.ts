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

/** Converte timestamp SRT/VTT (HH:MM:SS,mmm ou MM:SS.mmm) para segundos. */
export function parseTimestamp(raw: string): number | undefined {
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  if (nums.length === 3) {
    return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  }
  return nums[0]! * 60 + nums[1]!;
}

/**
 * Faz o parse de conteúdo de legenda nos formatos SRT ou WebVTT para lista de cues.
 */
export function parseCaptionFile(content: string): RawTrackInfo["cues"] {
  const lines = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: RawTrackInfo["cues"] = [];
  const timeRe = /^(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    const m = timeRe.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const start = parseTimestamp(m[1]!);
    const end = parseTimestamp(m[2]!);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      textLines.push(lines[i]!.trim());
      i++;
    }
    const text = stripCueMarkup(textLines.join(" ")).replace(/\s+/g, " ").trim();
    if (start !== undefined && end !== undefined && text) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/** Identifica o código de idioma normalizado ("pt", "en", etc.) a partir de `language` e `label`. */
export function detectTrackLanguageCode(track: { language?: string; label?: string }): string {
  const lang = (track.language ?? "").trim().toLowerCase();
  const label = (track.label ?? "").trim().toLowerCase();
  if (
    lang.startsWith("pt") ||
    lang.startsWith("por") ||
    /portugu[eê]s|portuguese|\bpt(?:[-_]br)?\b/i.test(label)
  ) {
    return "pt";
  }
  if (
    lang.startsWith("en") ||
    lang.startsWith("eng") ||
    /english|ingl[eê]s|\ben(?:[-_](?:us|gb))?\b/i.test(label)
  ) {
    return "en";
  }
  return lang || label;
}

/**
 * Lê as faixas de texto do <video> via API padrão `video.textTracks`
 * (incluindo elementos <video> dentro de Shadow DOM aberto) e <track src>.
 * Faixas desabilitadas são colocadas em "hidden" (carrega cues sem exibir)
 * e aguardadas por até `waitMs`. Só leitura de dados; nenhum script externo.
 */
export async function readVideoTextTracks(
  page: Page,
  videoSelector: string,
  waitMs = 3000,
): Promise<VideoTracksSnapshot | null> {
  const hasDirect = (await page.locator(videoSelector).count().catch(() => 0)) > 0;
  const hasGeneric =
    !hasDirect && videoSelector !== "video"
      ? (await page.locator("video").count().catch(() => 0)) > 0
      : false;

  const raw = await page
    .evaluate(
      async ({ sel, wait }) => {
        function findVideo(selector: string): HTMLVideoElement | null {
          const direct = document.querySelector(selector) as HTMLVideoElement | null;
          if (direct) return direct;
          const fallback = document.querySelector("video") as HTMLVideoElement | null;
          if (fallback) return fallback;
          const all = Array.from(document.querySelectorAll("*"));
          for (const el of all) {
            const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
            if (sr) {
              const v = (sr.querySelector(selector) ?? sr.querySelector("video")) as HTMLVideoElement | null;
              if (v) return v;
            }
          }
          return null;
        }

        const video = findVideo(sel);
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

        const tracks = list.map((t) => ({
          kind: t.kind,
          label: t.label,
          language: t.language,
          mode: t.mode,
          cues: Array.from(t.cues ?? []).map((c) => ({
            start: c.startTime,
            end: c.endTime,
            text: (c as VTTCue).text ?? "",
          })),
        }));

        // Fallback para tags <track src="..."> cujos cues ainda não foram populados pelo navegador
        const trackEls = Array.from(video.querySelectorAll("track"))
          .filter((el) => !el.kind || el.kind === "subtitles" || el.kind === "captions")
          .map((el) => ({
            kind: el.kind || "captions",
            label: el.label || "",
            language: el.srclang || "",
            src: el.src || "",
          }));

        return {
          duration: Number.isFinite(video.duration) ? video.duration : undefined,
          tracks,
          trackEls,
        };
      },
      { sel: videoSelector, wait: waitMs },
    )
    .catch(() => null);

  if (!raw) {
    if (!hasDirect && !hasGeneric) return null;
    return null;
  }

  const tracks: RawTrackInfo[] = [...raw.tracks];

  // Se nenhuma faixa tem cues populados mas há elementos <track src="...">, busca o conteúdo VTT/SRT
  if (tracks.every((t) => t.cues.length === 0) && raw.trackEls && raw.trackEls.length > 0) {
    for (const te of raw.trackEls) {
      if (!te.src) continue;
      const text = await page
        .evaluate(async (u) => {
          const r = await fetch(u);
          return r.ok ? await r.text() : null;
        }, te.src)
        .catch(() => null);
      if (text) {
        const cues = parseCaptionFile(text);
        if (cues.length > 0) {
          tracks.push({
            kind: te.kind,
            label: te.label,
            language: te.language,
            mode: "hidden",
            cues,
          });
        }
      }
    }
  }

  return {
    duration: raw.duration,
    tracks,
  };
}

/** Remove marcação WebVTT inline (<c>, <i>, <00:00:01.000>) do texto do cue. */
export function stripCueMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export function cuesToSegments(cues: RawTrackInfo["cues"]): TranscriptSegment[] {
  return cues.map((c) => ({ start: c.start, end: c.end, text: stripCueMarkup(c.text) }));
}

function languagePriority(track: RawTrackInfo, preferredLanguage: string): number {
  const pref = preferredLanguage.toLowerCase();
  const code = detectTrackLanguageCode(track);
  if (code.startsWith(pref)) return 2;
  if (pref !== "en" && code.startsWith("en")) return 1;
  return 0;
}

/**
 * Escolhe a melhor faixa: entre faixas com quantidade substancial de cues (>= 60% do máximo),
 * prioriza o idioma preferido (padrão "pt", com fallback para "en") e depois o número de cues.
 */
export function pickBestTrack(tracks: RawTrackInfo[], preferredLanguage = "pt"): RawTrackInfo | undefined {
  const withCues = tracks.filter((t) => t.cues.length > 0);
  if (withCues.length === 0) return undefined;
  const maxCues = Math.max(...withCues.map((t) => t.cues.length));
  return [...withCues].sort((a, b) => {
    const subA = a.cues.length >= maxCues * 0.6 ? 1 : 0;
    const subB = b.cues.length >= maxCues * 0.6 ? 1 : 0;
    if (subB !== subA) return subB - subA;
    const pa = languagePriority(a, preferredLanguage);
    const pb = languagePriority(b, preferredLanguage);
    if (pb !== pa) return pb - pa;
    return b.cues.length - a.cues.length;
  })[0];
}
