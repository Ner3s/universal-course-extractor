import { join } from "node:path";
import type { Logger } from "pino";
import { BrowserManager } from "../browser/browser-manager.js";
import type { AppConfig, PlatformConfig, PlatformsFile } from "../config/config.schema.js";
import { platformConfigSchema } from "../config/config.schema.js";
import { GenericAdapter } from "./generic/generic.adapter.js";
import { SkilljarAdapter } from "./skilljar/skilljar.adapter.js";
import { AdapterRegistry } from "./contracts/adapter-registry.js";
import type { CoursePlatformAdapter } from "./contracts/course-platform-adapter.js";

/** Adapter + ciclo de vida do navegador, tratados como uma unidade pelo núcleo. */
export interface PlatformRuntime {
  readonly adapter: CoursePlatformAdapter;
  /** Abre navegador e inicializa o adapter. */
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface PlatformResolver {
  /** Resolve por --platform (nome) ou pela URL. */
  resolve(opts: { url?: string; platform?: string; headed?: boolean }): Promise<PlatformRuntime>;
  byName(name: string, opts?: { headed?: boolean }): PlatformRuntime;
  names(): string[];
}

interface Entry {
  adapter: CoursePlatformAdapter;
  config: PlatformConfig;
  manager: BrowserManager;
}

/**
 * Composition root das plataformas. Adicionar uma plataforma = registrar aqui;
 * o pipeline central não muda (§5.5).
 */
export function createPlatformResolver(
  app: AppConfig,
  platforms: PlatformsFile,
  logger: Logger,
  defaultHeadedOverride?: boolean,
): PlatformResolver {
  const build = (headedOverride?: boolean) => {
    const entries = new Map<string, Entry>();
    const make = (name: string, factory: (manager: BrowserManager, cfg: PlatformConfig) => CoursePlatformAdapter) => {
      const cfg = platforms.platforms[name];
      if (!cfg || !cfg.enabled) return;
      const manager = new BrowserManager(
        {
          headed: headedOverride ?? defaultHeadedOverride ?? cfg.browser.headed,
          navigationTimeoutMs: cfg.browser.navigation_timeout,
          storageStatePath: join(app.dataDir, "browser", `${name}-storage.json`),
          diagnosticsDir: join(app.dataDir, "logs", "screenshots"),
        },
        logger,
      );
      entries.set(name, { adapter: factory(manager, cfg), config: cfg, manager });
    };
    make("skilljar", (manager, cfg) => new SkilljarAdapter(cfg.domains, { browserManager: manager }));
    make("generic", () => new GenericAdapter());
    return entries;
  };

  const runtimeFor = (entries: Map<string, Entry>, name: string): PlatformRuntime => {
    const e = entries.get(name);
    if (!e) throw new Error(`Platform "${name}" is not enabled or unknown (known: ${[...entries.keys()].join(", ")})`);
    return {
      adapter: e.adapter,
      async open() {
        const session = await e.manager.launch();
        await e.adapter.initialize({
          browser: session.browser,
          page: session.page,
          config: e.config ?? platformConfigSchema.parse({}),
          logger: logger.child({ platform: name }),
        });
      },
      async close() {
        await e.adapter.dispose();
        await e.manager.close();
      },
    };
  };

  return {
    names: () => [...build().keys()],
    byName(name, opts) {
      return runtimeFor(build(opts?.headed), name);
    },
    async resolve({ url, platform, headed }) {
      const entries = build(headed);
      if (platform) return runtimeFor(entries, platform);
      if (!url) throw new Error("A URL or --platform is required to select a platform");
      const registry = new AdapterRegistry([...entries.values()].map((e) => e.adapter));
      const adapter = await registry.resolve(url, entries.has("generic") ? "generic" : undefined);
      logger.info({ platform: adapter.name }, "Platform identified");
      return runtimeFor(entries, adapter.name);
    },
  };
}
