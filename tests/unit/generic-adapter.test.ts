import { describe, it, expect } from "vitest";
import { GenericAdapter } from "../../src/platforms/generic/generic.adapter.js";
import { platformConfigSchema } from "../../src/config/config.schema.js";

describe("GenericAdapter", () => {
  it("aceita apenas http(s) (uso como fallback)", async () => {
    const a = new GenericAdapter();
    expect(await a.canHandle("https://x.com")).toBe(true);
    expect(await a.canHandle("ftp://x.com")).toBe(false);
    expect(await a.canHandle("nope")).toBe(false);
  });
  it("falha com erro claro sem seletores obrigatórios", async () => {
    const a = new GenericAdapter();
    await expect(
      a.initialize({ config: platformConfigSchema.parse({}) } as never),
    ).rejects.toThrow(/lesson_links, lesson_content/);
  });
});
