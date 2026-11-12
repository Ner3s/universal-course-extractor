# Coding Standards

Rules enforced during `/code-review`. Every rule captures an architectural invariant or judgement call across modules.

## Platform-agnostic core

Keep `src/core/`, `src/processors/`, `src/ai/`, `src/discovery/`, and `src/storage/` free of platform-specific selectors, URLs, or DOM heuristics. Route all platform behavior through `CoursePlatformAdapter` (`src/platforms/contracts/`) and `TranscriptStrategy` (`src/extraction/strategy.ts`). Register new adapters in `src/platforms/runtime.ts` and cover them with `runAdapterContract` (`tests/contracts/adapter-contract.ts`).

## AI operation isolation

Maintain strict separation between the two AI operations:

- **Summarization (`Summarizer`)** receives only the cleaned lesson transcript (`cleanTranscript`). It produces the structured pt-BR summary and never receives page HTML/Markdown content.
- **Translation (`MarkdownTranslator` / `Translator`)** receives only the converted lesson Markdown. Protect fenced code blocks with `[[[CODE_BLOCK_n]]]` placeholders via `protectCodeBlocks` before sending chunks to the model, validate every translated chunk with `validateTranslatedChunk` (preserving placeholders, URLs, heading counts, list item counts, and table rows), and restore code blocks with `restoreCodeBlocks`.
- Wrap all external course text in untrusted delimiters (`<<<CONTEUDO>>>` ... `<<<FIM>>>`) before including it in prompts.

## Transcript completeness and lesson status

- Set `complete: true` on a video transcript only when `assessCoverage` verifies both segment timestamps (`start`/`end`) and a finite positive `durationSeconds`. Unverified transcripts produce `status: "partial"`.
- Prioritize caption tracks in Portuguese (`pt` / `pt-BR` / `Portuguese`) first, English (`en` / `English`) second, and other languages third, inspecting both `language` and `label`.
- Mark a lesson `completed` in `LessonProcessor` when:
  1. It has a verified complete transcript (`complete: true`) and translated content (or is a `"video-only"` lesson with no text pane), or
  2. It is a text-only lesson (`noVideo: true`, reason `"No video in this lesson"`) with translated content.

## Resumable state and safe storage

- Persist each stage (`transcript`, `content`, `summary`, `translation`) in `ProgressRepository` as soon as it finishes so `resume` reuses completed stages without repeating AI calls.
- Write final Obsidian notes atomically via `MarkdownWriter` (temp file + rename) and respect the active `ConflictPolicy` (`ask`, `skip`, `overwrite`).
- In `node:sqlite` queries (`SQLITE_DQS=0`), bind values with `?` parameters or single-quoted `'...'` SQL string literals. Double-quoted strings in SQL are parsed as column identifiers and fail at runtime.

## Security and logging

- Redact credentials, cookies, and tokens in Pino logs; store browser session state (`storageState`) under `data/browser/` with mode `0600`.
- Sanitize extracted lesson HTML (`sanitize-html`) before Markdown conversion.
