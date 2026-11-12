import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import type { Logger } from "pino";
import type { BrowserOptions, BrowserSession } from "./browser-types.js";
import { SessionManager } from "./session-manager.js";

export class BrowserManager {
  private session?: BrowserSession;
  readonly sessions: SessionManager;

  constructor(
    private readonly options: BrowserOptions,
    private readonly logger: Logger,
  ) {
    this.sessions = new SessionManager(options.storageStatePath);
  }

  async launch(): Promise<BrowserSession> {
    if (this.session) return this.session;
    const browser = await chromium.launch({ headless: !this.options.headed });
    const context = await browser.newContext({
      storageState: this.sessions.storageStateForLoad(),
      // Nunca executamos scripts nossos em nome da página; só leitura.
      acceptDownloads: false,
    });
    context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
    context.setDefaultTimeout(this.options.navigationTimeoutMs);
    const page = await context.newPage();
    this.session = { browser, context, page };
    this.logger.info({ headed: this.options.headed }, "Browser launched");
    return this.session;
  }

  async saveSession(): Promise<void> {
    if (!this.session) throw new Error("Browser not launched");
    await this.sessions.save(this.session.context);
    this.logger.info("Session saved");
  }

  /** Captura screenshot para diagnóstico; nunca lança. */
  async screenshot(page: Page, label: string): Promise<string | undefined> {
    try {
      await mkdir(this.options.diagnosticsDir, { recursive: true });
      const file = join(this.options.diagnosticsDir, `${Date.now()}-${label.replace(/[^a-z0-9-]/gi, "_")}.png`);
      await page.screenshot({ path: file, fullPage: true });
      return file;
    } catch (err) {
      this.logger.warn({ err: String(err) }, "Screenshot failed");
      return undefined;
    }
  }

  async close(): Promise<void> {
    if (!this.session) return;
    await this.session.browser.close();
    this.session = undefined;
  }
}
