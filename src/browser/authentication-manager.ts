import type { Page } from "playwright";
import type { Logger } from "pino";
import type { AuthenticationResult } from "../types/index.js";
import type { BrowserManager } from "./browser-manager.js";

export interface ManualAuthOptions {
  startUrl: string;
  /** Verifica se a página atual está autenticada (específico da plataforma). */
  isAuthenticated: (page: Page) => Promise<boolean>;
  /** Aguarda confirmação do usuário de que concluiu o login. */
  waitForUserConfirmation: () => Promise<void>;
}

export class AuthenticationManager {
  constructor(
    private readonly browser: BrowserManager,
    private readonly logger: Logger,
  ) {}

  /** Retorna true se a sessão salva ainda é válida. */
  async hasValidSession(page: Page, opts: Pick<ManualAuthOptions, "startUrl" | "isAuthenticated">): Promise<boolean> {
    if (!this.browser.sessions.exists()) return false;
    await page.goto(opts.startUrl, { waitUntil: "domcontentloaded" });
    return opts.isAuthenticated(page);
  }

  /** Fluxo de login manual (§7.2). Senhas nunca passam por esta aplicação. */
  async authenticateManually(page: Page, opts: ManualAuthOptions): Promise<AuthenticationResult> {
    if (await this.hasValidSession(page, opts)) {
      this.logger.info("Existing session is valid");
      return { authenticated: true, message: "Existing session reused" };
    }
    if (this.browser.sessions.exists()) {
      this.logger.warn("Saved session expired; manual login required");
    }
    await page.goto(opts.startUrl, { waitUntil: "domcontentloaded" });
    await opts.waitForUserConfirmation();
    if (!(await opts.isAuthenticated(page))) {
      return { authenticated: false, message: "Login not detected after confirmation" };
    }
    await this.browser.saveSession();
    return { authenticated: true, message: "Session saved" };
  }
}
