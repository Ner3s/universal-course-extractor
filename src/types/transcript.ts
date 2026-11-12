export interface TranscriptSegment {
  start?: number;
  end?: number;
  text: string;
}

export type TranscriptSource =
  | "native"
  | "captions"
  | "text-track"
  | "speech-to-text";

/** Transcrição encontrada (completa ou parcial). */
export interface TranscriptData {
  text: string;
  language?: string;
  segments?: TranscriptSegment[];
  source: TranscriptSource;
  /** Só pode ser true com evidência de cobertura (ver §10.5). */
  complete: boolean;
  confidence?: number;
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

/**
 * Estados explícitos (§6): a ausência de transcrição nunca é uma string vazia.
 */
export type TranscriptResult =
  | ({ status: "found" } & TranscriptData)
  | ({ status: "partial" } & TranscriptData)
  | { status: "unavailable"; reason: string; warnings?: string[] }
  | { status: "failed"; error: string; warnings?: string[] }
  | { status: "needs-speech-recognition"; reason: string; warnings?: string[] };
