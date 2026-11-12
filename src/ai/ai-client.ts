import OpenAI from "openai";
import type { Logger } from "pino";
import { aiConfigSchema, type AiConfig } from "../config/config.schema.js";
import {
  AiConnectionError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ConnectionReport,
} from "./ai-provider.interface.js";

/** Cliente para qualquer servidor compatível com a API OpenAI (llama.cpp, etc.). */
export class OpenAiCompatibleClient implements AiProvider {
  private readonly config: AiConfig;
  private readonly sdk: OpenAI;

  constructor(
    config: AiConfig,
    private readonly logger: Logger,
    sdk?: OpenAI,
  ) {
    this.config = aiConfigSchema.parse(config);
    this.sdk =
      sdk ??
      new OpenAI({
        baseURL: this.config.baseUrl,
        apiKey: this.config.apiKey,
        timeout: this.config.timeoutMs,
        maxRetries: this.config.maxRetries,
      });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.sdk.chat.completions.create({
      model: this.config.model,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    });
    const choice = res.choices[0];
    return {
      text: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? undefined,
    };
  }

  async checkConnection(): Promise<ConnectionReport> {
    const warnings: string[] = [];
    let models: string[] = [];
    try {
      const list = await this.sdk.models.list();
      models = list.data.map((m) => m.id);
      if (models.length > 0 && !models.includes(this.config.model)) {
        warnings.push(
          `Model "${this.config.model}" not listed by the server (available: ${models.slice(0, 10).join(", ")})`,
        );
      }
    } catch (err) {
      const msg = describeError(err);
      if (/ECONNREFUSED|ENOTFOUND|connection|timed? ?out|fetch failed/i.test(msg)) {
        throw new AiConnectionError(
          `Cannot reach AI endpoint ${this.config.baseUrl}: ${msg}. Is the server running?`,
        );
      }
      warnings.push(`Could not list models (${msg}); continuing`);
    }

    try {
      const r = await this.complete({
        system: "You are a connectivity test.",
        user: "Reply with the single word: OK",
        maxTokens: 16,
        temperature: 0,
      });
      if (!r.text.trim()) warnings.push("Test request returned an empty response");
    } catch (err) {
      throw new AiConnectionError(
        `Test request to model "${this.config.model}" at ${this.config.baseUrl} failed: ${describeError(err)}`,
      );
    }
    this.logger.info({ baseUrl: this.config.baseUrl, model: this.config.model }, "AI endpoint reachable");
    return { models, warnings };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    return cause ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}
