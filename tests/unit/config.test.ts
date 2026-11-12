import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadAppConfig, parsePlatformsConfig } from "../../src/config/config.loader.js";

describe("loadAppConfig", () => {
  it("usa defaults quando o ambiente está vazio", () => {
    const c = loadAppConfig({});
    expect(c.ai.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(c.outputDir).toBe("dist");
  });
  it("lê variáveis de ambiente", () => {
    const c = loadAppConfig({ AI_MODEL: "m", AI_MAX_TOKENS: "1024", AI_TEMPERATURE: "0.5" });
    expect(c.ai.model).toBe("m");
    expect(c.ai.maxTokens).toBe(1024);
    expect(c.ai.temperature).toBe(0.5);
  });
  it("rejeita URL inválida", () => {
    expect(() => loadAppConfig({ AI_BASE_URL: "nope" })).toThrow();
  });
  it("rejeita número inválido", () => {
    expect(() => loadAppConfig({ AI_TIMEOUT: "abc" })).toThrow();
  });
});

describe("parsePlatformsConfig", () => {
  it("valida o arquivo de exemplo", () => {
    const cfg = parsePlatformsConfig(readFileSync("config/platforms.example.yaml", "utf8"));
    expect(cfg.platforms.skilljar?.domains).toContain("anthropic-partners.skilljar.com");
    expect(cfg.platforms.skilljar?.selectors.lesson_links).toBe("#curriculum-list-2 a");
  });
  it("rejeita estrutura inválida", () => {
    expect(() => parsePlatformsConfig("platforms:\n  x:\n    enabled: maybe\n")).toThrow();
  });
});
