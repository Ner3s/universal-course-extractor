import { describe, it, expect } from "vitest";
import {
  AdapterRegistry,
  AmbiguousPlatformError,
  UnsupportedPlatformError,
} from "../../src/platforms/contracts/index.js";
import { FakeAdapter } from "../fixtures/fake-adapter.js";

describe("AdapterRegistry", () => {
  const a = new FakeAdapter("a", "a.example.com");
  const b = new FakeAdapter("b", "b.example.com");

  it("resolve o adapter correto", async () => {
    const r = new AdapterRegistry([a, b]);
    expect(await r.resolve("https://b.example.com/x")).toBe(b);
  });

  it("lança erro para plataforma não suportada", async () => {
    const r = new AdapterRegistry([a, b]);
    await expect(r.resolve("https://c.example.com")).rejects.toBeInstanceOf(
      UnsupportedPlatformError,
    );
  });

  it("lança erro para identificação ambígua", async () => {
    const r = new AdapterRegistry([a, new FakeAdapter("a2", "a.example.com")]);
    await expect(r.resolve("https://a.example.com")).rejects.toBeInstanceOf(
      AmbiguousPlatformError,
    );
  });

  it("ignora adapter cujo canHandle lança erro", async () => {
    const broken = new FakeAdapter("broken", "x");
    broken.canHandle = async () => {
      throw new Error("init failure");
    };
    const r = new AdapterRegistry([broken, a]);
    expect(await r.resolve("https://a.example.com")).toBe(a);
  });

  it("usa fallback somente quando nenhum específico aceita", async () => {
    const generic = new FakeAdapter("generic", "z.example.com");
    generic.canHandle = async () => true;
    const r = new AdapterRegistry([generic, a]);
    expect(await r.resolve("https://a.example.com", "generic")).toBe(a);
    expect(await r.resolve("https://q.example.com", "generic")).toBe(generic);
  });

  it("rejeita nomes duplicados", () => {
    expect(() => new AdapterRegistry([a, a])).toThrow(/Duplicate/);
  });

  it("getByName", () => {
    const r = new AdapterRegistry([a, b]);
    expect(r.getByName("a")).toBe(a);
    expect(() => r.getByName("nope")).toThrow();
  });
});
