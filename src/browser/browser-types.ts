import type { Browser, BrowserContext, Page } from "playwright";

export interface BrowserOptions {
  headed: boolean;
  navigationTimeoutMs: number;
  /** Caminho do storageState a reutilizar/salvar. */
  storageStatePath: string;
  /** Diretório para screenshots de diagnóstico. */
  diagnosticsDir: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}
