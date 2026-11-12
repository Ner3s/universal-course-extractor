import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext } from "playwright";

/** Persistência do storageState com permissões restritas (0600). */
export class SessionManager {
  constructor(private readonly path: string) {}

  exists(): boolean {
    return existsSync(this.path);
  }

  /** Retorna o caminho para uso em newContext, ou undefined se não houver sessão. */
  storageStateForLoad(): string | undefined {
    return this.exists() ? this.path : undefined;
  }

  async save(context: BrowserContext): Promise<void> {
    const state = await context.storageState();
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(state), { mode: 0o600 });
    await chmod(this.path, 0o600);
  }
}
