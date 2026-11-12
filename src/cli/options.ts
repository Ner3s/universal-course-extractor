import { CliUsageError } from "./errors.js";
import { validateSelectionInput, type SelectionInput } from "../discovery/lesson-discovery.js";

export interface ScrapeOptions extends SelectionInput {
  url?: string;
  platform?: string;
  course?: string;
  output?: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  dryRun?: boolean;
  headed?: boolean;
  headless?: boolean;
  /** Modo não interativo: não pede confirmações. */
  yes?: boolean;
}

export function validateScrapeOptions(o: ScrapeOptions): void {
  validateSelectionInput(o);
  if (o.overwrite && o.skipExisting) {
    throw new CliUsageError("Conflicting options: --overwrite and --skip-existing");
  }
  if (o.headed && o.headless) {
    throw new CliUsageError("Conflicting options: --headed and --headless");
  }
  if (o.url) {
    try {
      const u = new URL(o.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      throw new CliUsageError(`Invalid --url: ${o.url}`);
    }
  }
}

/** Retorna true/false se o usuário forçou um modo; undefined para usar a configuração. */
export function headedOverride(o: Pick<ScrapeOptions, "headed" | "headless">): boolean | undefined {
  if (o.headed) return true;
  if (o.headless) return false;
  return undefined;
}
