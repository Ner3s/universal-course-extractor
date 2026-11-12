import type { TranscriptStrategy } from "../strategy.js";
import { readVideoTextTracks } from "../text-tracks.js";
import { snapshotToResult } from "./snapshot-result.js";

interface JwCaption {
  label?: string;
  id?: string;
}

/**
 * Usa a API pública do JW Player (`getCaptionsList` / `setCurrentCaptions`)
 * para ativar uma legenda e então lê os cues expostos em `video.textTracks`.
 * Não depende de classes CSS. Retorna null se o player não expõe a API.
 */
export class PlayerCaptionStrategy implements TranscriptStrategy {
  readonly name = "player-caption";

  async extract({ page, selectors, logger }: Parameters<TranscriptStrategy["extract"]>[0]) {
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

    // Prefere inglês; senão a primeira faixa real.
    const idx = Math.max(
      1,
      list.findIndex((c, i) => i > 0 && /english|^en\b/i.test(c.label ?? "")),
    );
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
