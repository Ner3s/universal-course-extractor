import type { TranscriptStrategy } from "../strategy.js";

export const NO_VIDEO_REASON = "No video in this lesson";

/**
 * Placeholder (§10.4). Não obtém áudio nem contorna proteções. Apenas sinaliza
 * que, sem outras fontes, seria necessário um serviço local de speech-to-text
 * e autorização do usuário (quando há vídeo na aula).
 */
export class SpeechRecognitionStrategy implements TranscriptStrategy {
  readonly name = "speech-recognition";

  async extract({ page, selectors }: Parameters<TranscriptStrategy["extract"]>[0]) {
    if (typeof page?.evaluate === "function") {
      const sel = selectors?.video || "video";
      const hasVideo = await page
        .evaluate((s) => {
          if (document.querySelector(s) || document.querySelector("video")) return true;
          if (document.querySelector("sjwc-video, [id^='botr_'][id$='_div'], .video-player")) return true;
          const w = window as unknown as { videoJsArgs?: unknown; jwplayer?: unknown };
          if (w.videoJsArgs || typeof w.jwplayer === "function") return true;
          return false;
        }, sel)
        .catch(() => null);
      if (hasVideo === false) {
        return {
          status: "unavailable" as const,
          reason: NO_VIDEO_REASON,
        };
      }
    }
    return {
      status: "needs-speech-recognition" as const,
      reason:
        "No transcript or captions found. Speech-to-text is not implemented in this version.",
    };
  }
}
