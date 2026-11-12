import type { TranscriptStrategy } from "../strategy.js";

/**
 * Placeholder (§10.4). Não obtém áudio nem contorna proteções. Apenas sinaliza
 * que, sem outras fontes, seria necessário um serviço local de speech-to-text
 * e autorização do usuário. Integração (ex.: Whisper) fica para versão futura.
 */
export class SpeechRecognitionStrategy implements TranscriptStrategy {
  readonly name = "speech-recognition";

  async extract() {
    return {
      status: "needs-speech-recognition" as const,
      reason:
        "No transcript or captions found. Speech-to-text is not implemented in this version.",
    };
  }
}
