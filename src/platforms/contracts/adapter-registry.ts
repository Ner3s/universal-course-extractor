import type { CoursePlatformAdapter } from "./course-platform-adapter.js";

export class UnsupportedPlatformError extends Error {
  constructor(url: string) {
    super(`Unsupported course platform for URL: ${url}`);
    this.name = "UnsupportedPlatformError";
  }
}

export class AmbiguousPlatformError extends Error {
  constructor(url: string, names: string[]) {
    super(`Ambiguous platform for URL ${url}: matched ${names.join(", ")}`);
    this.name = "AmbiguousPlatformError";
  }
}

export class AdapterRegistry {
  private readonly adapters: CoursePlatformAdapter[];

  constructor(adapters: CoursePlatformAdapter[]) {
    const names = new Set<string>();
    for (const a of adapters) {
      if (names.has(a.name)) {
        throw new Error(`Duplicate adapter name: ${a.name}`);
      }
      names.add(a.name);
    }
    this.adapters = [...adapters];
  }

  list(): string[] {
    return this.adapters.map((a) => a.name);
  }

  getByName(name: string): CoursePlatformAdapter {
    const found = this.adapters.find((a) => a.name === name);
    if (!found) throw new Error(`Unknown platform: ${name}`);
    return found;
  }

  /**
   * Resolve o adapter para a URL. Adapters com erro em canHandle são tratados
   * como não compatíveis. Mais de um match gera erro (identificação ambígua).
   * O fallback (ex.: generic) deve ser passado via `fallbackName` e só é usado
   * quando nenhum adapter específico aceita a URL.
   */
  async resolve(url: string, fallbackName?: string): Promise<CoursePlatformAdapter> {
    const matches: CoursePlatformAdapter[] = [];
    for (const adapter of this.adapters) {
      if (adapter.name === fallbackName) continue;
      try {
        if (await adapter.canHandle(url)) matches.push(adapter);
      } catch {
        // adapter com falha de inicialização não participa da resolução
      }
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new AmbiguousPlatformError(url, matches.map((m) => m.name));
    }
    if (fallbackName) {
      const fb = this.adapters.find((a) => a.name === fallbackName);
      if (fb && (await fb.canHandle(url).catch(() => false))) return fb;
    }
    throw new UnsupportedPlatformError(url);
  }
}
