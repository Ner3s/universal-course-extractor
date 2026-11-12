import type { TranscriptStrategy } from "../strategy.js";
import { readVideoTextTracks } from "../text-tracks.js";
import { snapshotToResult } from "./snapshot-result.js";

/** Inspeciona `video.textTracks` (§10.2). */
export class TextTrackStrategy implements TranscriptStrategy {
  readonly name = "text-track";

  async extract({ page, selectors, logger }: Parameters<TranscriptStrategy["extract"]>[0]) {
    const sel = selectors.video || "video";
    const snapshot = await readVideoTextTracks(page, sel);
    if (!snapshot) {
      logger.debug({ selector: sel }, "No video element for text tracks");
      return null;
    }
    logger.debug(
      { tracks: snapshot.tracks.map((t) => ({ lang: t.language, cues: t.cues.length })) },
      "Text tracks inspected",
    );
    return snapshotToResult(snapshot, "text-track");
  }
}
