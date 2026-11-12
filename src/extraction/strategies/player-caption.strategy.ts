import type { Page } from "playwright";
import type { TranscriptStrategy } from "../strategy.js";
import {
  detectTrackLanguageCode,
  parseCaptionFile,
  readVideoTextTracks,
  type RawTrackInfo,
} from "../text-tracks.js";
import { snapshotToResult } from "./snapshot-result.js";

interface JwCaption {
  label?: string;
  id?: string;
  language?: string;
}

interface JwPlaylistTrack {
  file?: string;
  kind?: string;
  label?: string;
  language?: string;
}

interface JwPlaylistItem {
  duration?: number;
  tracks?: JwPlaylistTrack[];
}

interface DiscoveredJwMedia {
  mediaUrl?: string;
  playlistItem?: JwPlaylistItem;
}

async function fetchText(page: Page, url: string): Promise<string | null> {
  const fromPage = await page
    .evaluate(async (u) => {
      const r = await fetch(u);
      return r.ok ? await r.text() : null;
    }, url)
    .catch(() => null);
  if (fromPage) return fromPage;

  try {
    const r = await fetch(url);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/**
 * Extrai legendas (CC) de players JWPlayer / Skilljar (<sjwc-video>, videoJsArgs,
 * div botr_* ou API `window.jwplayer`), priorizando Português (pt-BR/pt) com
 * fallback para Inglês (en).
 */
export class PlayerCaptionStrategy implements TranscriptStrategy {
  readonly name = "player-caption";

  async extract({ page, selectors, logger }: Parameters<TranscriptStrategy["extract"]>[0]) {
    // 1. Tenta descobrir manifesto de mídia JWPlayer (sjwc-video, videoJsArgs, botr_*, ou jwplayer().getPlaylist())
    const discovered: DiscoveredJwMedia | null = await page
      .evaluate(() => {
        // Caso A: Web Component <sjwc-video video-id="..." token="...">
        const sjwc = document.querySelector("sjwc-video");
        if (sjwc) {
          const videoId = sjwc.getAttribute("video-id")?.trim();
          const token = sjwc.getAttribute("token")?.trim();
          if (videoId) {
            const qs = token ? `?token=${encodeURIComponent(token)}` : "";
            return { mediaUrl: `https://cdn.jwplayer.com/v2/media/${videoId}${qs}` };
          }
        }

        // Caso B: API jwplayer().getPlaylist() já carregada na janela
        const jw = (
          window as unknown as {
            jwplayer?: () => {
              getPlaylist?: () => JwPlaylistItem[];
            };
          }
        ).jwplayer;
        if (typeof jw === "function") {
          try {
            const item = jw()?.getPlaylist?.()?.[0];
            if (item && Array.isArray(item.tracks) && item.tracks.length > 0) {
              return { playlistItem: { duration: item.duration, tracks: item.tracks } };
            }
          } catch {
            // continua para detecção via DOM/videoJsArgs
          }
        }

        // Caso C: videoJsArgs.assetJWPlayerUrl ou assetJWPlayerDivId no escopo global
        const vArgs = (
          window as unknown as {
            videoJsArgs?: { assetJWPlayerUrl?: string; assetJWPlayerDivId?: string };
          }
        ).videoJsArgs;
        if (vArgs?.assetJWPlayerUrl) {
          const m = /\/players\/([A-Za-z0-9]+)-[A-Za-z0-9]+\.js/.exec(vArgs.assetJWPlayerUrl);
          if (m?.[1]) return { mediaUrl: `https://cdn.jwplayer.com/v2/media/${m[1]}` };
        }
        if (vArgs?.assetJWPlayerDivId) {
          const m = /^botr_([A-Za-z0-9]+)_[A-Za-z0-9]+_div$/.exec(vArgs.assetJWPlayerDivId);
          if (m?.[1]) return { mediaUrl: `https://cdn.jwplayer.com/v2/media/${m[1]}` };
        }

        // Caso D: div#botr_<mediaId>_<playerId>_div no DOM
        const botr = document.querySelector('[id^="botr_"][id$="_div"]');
        if (botr?.id) {
          const m = /^botr_([A-Za-z0-9]+)_[A-Za-z0-9]+_div$/.exec(botr.id);
          if (m?.[1]) return { mediaUrl: `https://cdn.jwplayer.com/v2/media/${m[1]}` };
        }

        return null;
      })
      .catch(() => null);

    let playlistItem = discovered?.playlistItem;
    if (!playlistItem && discovered?.mediaUrl) {
      const rawJson = await fetchText(page, discovered.mediaUrl);
      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson) as { playlist?: JwPlaylistItem[] };
          playlistItem = parsed.playlist?.[0];
        } catch {
          logger.debug({ mediaUrl: discovered.mediaUrl }, "Failed to parse JWPlayer media JSON");
        }
      }
    }

    if (playlistItem?.tracks && playlistItem.tracks.length > 0) {
      const captionTracks = playlistItem.tracks.filter(
        (t) =>
          Boolean(t.file) &&
          (t.kind === "captions" ||
            t.kind === "subtitles" ||
            (!t.kind && /\.(srt|vtt)(\?|$)/i.test(t.file!))),
      );

      if (captionTracks.length > 0) {
        // Ordena priorizando Português (pt), depois Inglês (en), depois demais
        const sorted = [...captionTracks].sort((a, b) => {
          const rank = (t: JwPlaylistTrack) => {
            const code = detectTrackLanguageCode(t);
            if (code.startsWith("pt")) return 2;
            if (code.startsWith("en")) return 1;
            return 0;
          };
          return rank(b) - rank(a);
        });

        const loadedTracks: RawTrackInfo[] = [];
        for (const t of sorted) {
          const fileUrl = t.file!;
          const content = await fetchText(page, fileUrl);
          if (!content) continue;
          const cues = parseCaptionFile(content);
          if (cues.length === 0) continue;
          const langCode = detectTrackLanguageCode(t);
          loadedTracks.push({
            kind: t.kind ?? "captions",
            label: t.label ?? langCode,
            language: t.language ?? langCode,
            mode: "showing",
            cues,
          });
          // Assim que carregamos a faixa de maior prioridade com cues válidos, podemos parar
          // se já for português ou inglês.
          if (langCode === "pt" || langCode === "en") break;
        }

        if (loadedTracks.length > 0) {
          const chosen = loadedTracks[0]!;
          logger.debug(
            { label: chosen.label, language: chosen.language, cues: chosen.cues.length },
            "Captions downloaded from player manifest",
          );
          return snapshotToResult(
            {
              duration:
                typeof playlistItem.duration === "number" && playlistItem.duration > 0
                  ? playlistItem.duration
                  : undefined,
              tracks: loadedTracks,
            },
            "captions",
          );
        }
      }
    }

    // 2. Fallback: API interativa `jwplayer().getCaptionsList()` + `setCurrentCaptions()`
    const list: JwCaption[] | null = await page
      .evaluate(() => {
        const jw = (window as unknown as { jwplayer?: () => { getCaptionsList?: () => JwCaption[] } })
          .jwplayer;
        if (typeof jw !== "function") return null;
        const player = jw();
        return player?.getCaptionsList?.() ?? null;
      })
      .catch(() => null);
    if (!list || list.length <= 1) return null; // índice 0 é "Off"

    const ptIdx = list.findIndex(
      (c, i) => i > 0 && /portugu[eê]s|portuguese|^pt\b/i.test(`${c.label ?? ""} ${c.language ?? ""}`),
    );
    const enIdx = list.findIndex(
      (c, i) => i > 0 && /english|ingl[eê]s|^en\b/i.test(`${c.label ?? ""} ${c.language ?? ""}`),
    );
    const idx = ptIdx > 0 ? ptIdx : enIdx > 0 ? enIdx : 1;

    await page.evaluate((i) => {
      const jw = (window as unknown as { jwplayer: () => { setCurrentCaptions: (n: number) => void } })
        .jwplayer;
      jw().setCurrentCaptions(i);
    }, idx);
    logger.debug({ label: list[idx]?.label }, "Player caption selected");

    const snapshot = await readVideoTextTracks(page, selectors.video || "video", 5000);
    if (!snapshot) return null;
    return snapshotToResult(snapshot, "captions", [
      `Captions selected via player API (${list[idx]?.label ?? "unknown"})`,
    ]);
  }
}
