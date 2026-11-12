# Skilljar DOM & Video Player Reference

Reference for `src/platforms/skilljar/` and `src/extraction/strategies/player-caption.strategy.ts`.

## Three lesson page layouts

Skilljar courses mix three distinct lesson layouts under `#lesson-main`:

1. **Video + Summary Pane:** Video player in `#lesson-main-content` plus written HTML inside `#details-pane-summary-content`.
2. **Text-Only Guide (no video):** Written HTML inside `sjwc-lesson-content-item.course-text-content` (or `.course-text-content`), with no `#details-pane` and no video player on the page. `SpeechRecognitionStrategy` returns `status: "unavailable"` with reason `"No video in this lesson"`, and `LessonProcessor` marks the lesson `completed`.
3. **Video-Only (no text pane):** Video player in `#lesson-main-content` with neither `#details-pane-summary-content` nor `.course-text-content`. `SkilljarExtractor.getContentHtml` detects the lesson shell (`sjwc-video, [id^='botr_'][id$='_div'], .course-fixed-content-video, .video-player, video, .lesson-top`) and returns `{ html: "", source: "video-only" }` immediately without waiting for a selector timeout.

## Two JWPlayer embedding patterns

Skilljar embeds JWPlayer using two mechanisms that load asynchronously after `domcontentloaded`:

1. **Flexible Content Web Component (`<sjwc-video>`):**
   ```html
   <sjwc-video video-id="OXpTVHvp" type="VIDEO_JWPLAYER" player-id="Akyo8gQO" token="eyJ..." />
   ```
   Manifest URL: `https://cdn.jwplayer.com/v2/media/<video-id>?token=<token>`
2. **Legacy `videoJsArgs` / `botr` container:**
   ```js
   videoJsArgs.assetJWPlayerUrl = "//content.jwplatform.com/players/Ju43Csrd-Akyo8gQO.js";
   videoJsArgs.assetJWPlayerDivId = "botr_Ju43Csrd_Akyo8gQO_div";
   ```
   Manifest URL: `https://cdn.jwplayer.com/v2/media/<mediaId>`

## JWPlayer v2 Media Manifest & Captions

Fetching `https://cdn.jwplayer.com/v2/media/<mediaId>` returns JSON with `playlist[0].duration` (seconds) and `playlist[0].tracks`:

```json
{
  "duration": 318,
  "tracks": [
    { "file": "https://cdn.jwplayer.com/tracks/fY9L5XMD.srt", "kind": "captions", "label": "English" },
    { "file": "https://cdn.jwplayer.com/tracks/o1qYhbev.srt", "kind": "captions", "label": "Portuguese" },
    { "file": "https://cdn.jwplayer.com/strips/Ju43Csrd-120.vtt", "kind": "thumbnails" }
  ]
}
```

- Filter `tracks` by `kind === "captions" || kind === "subtitles"` (ignore `thumbnails`).
- Track entries often omit `language` and only populate `label` (`"Portuguese"`, `"English"`). Always resolve language via `detectTrackLanguageCode` (which checks both `language` and `label`).
- Track files are often `.srt` (comma millisecond separator `00:00:00,031 --> 00:00:02,875`); parse with `parseCaptionFile`.
