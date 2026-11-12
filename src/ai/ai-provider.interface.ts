export interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  /** "stop" | "length" | ... conforme o provedor. */
  finishReason?: string;
}

export interface ConnectionReport {
  models: string[];
  warnings: string[];
}

export interface AiProvider {
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /** Valida configuração, conectividade, modelos e uma requisição de teste (§12.3). */
  checkConnection(): Promise<ConnectionReport>;
}

export class AiConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConnectionError";
  }
}
