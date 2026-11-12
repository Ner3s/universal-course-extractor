import { join } from "node:path";
import type { Logger } from "pino";
import { OpenAiCompatibleClient } from "../ai/ai-client.js";
import type { AiProvider } from "../ai/ai-provider.interface.js";
import { Summarizer } from "../ai/summarizer.js";
import { Translator } from "../ai/translator.js";
import type { AppConfig } from "../config/config.schema.js";
import { TranscriptStore } from "../extraction/transcript-store.js";
import { MarkdownTranslator } from "../processors/markdown-translator.js";
import type { CoursePlatformAdapter } from "../platforms/contracts/course-platform-adapter.js";
import {
  MarkdownWriter,
  type ConflictDecision,
  type ConflictInfo,
  type ConflictPolicy,
} from "../storage/writers/markdown-writer.js";
import type { ProgressRepository } from "../storage/repositories/progress.repository.js";
import { LessonProcessor, type ProgressEvent } from "./lesson-processor.js";

export interface ProcessorFactoryInput {
  adapter: CoursePlatformAdapter;
  policy: ConflictPolicy;
  resolveConflict?: (info: ConflictInfo) => Promise<ConflictDecision>;
  onProgress?: (e: ProgressEvent) => void;
}

export type ProcessorFactory = (input: ProcessorFactoryInput) => LessonProcessor;

export function createAiProvider(config: AppConfig, logger: Logger): AiProvider {
  return new OpenAiCompatibleClient(config.ai, logger);
}

/** Monta o grafo de serviços do pipeline a partir da configuração. */
export function createProcessorFactory(
  config: AppConfig,
  logger: Logger,
  progress: ProgressRepository,
  provider: AiProvider,
): ProcessorFactory {
  return ({ adapter, policy, resolveConflict, onProgress }) =>
    new LessonProcessor({
      adapter,
      progress,
      logger,
      onProgress,
      transcriptStore: new TranscriptStore(join(config.dataDir, "transcripts")),
      summarizer: new Summarizer(provider, { chunkChars: config.ai.chunkChars, logger }),
      translator: new MarkdownTranslator(new Translator(provider), {
        chunkChars: config.ai.chunkChars,
        maxRetries: config.ai.maxRetries,
        logger,
      }),
      writer: new MarkdownWriter(policy, resolveConflict),
    });
}
