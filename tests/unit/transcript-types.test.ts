import { describe, it, expect } from "vitest";
import type { TranscriptResult } from "../../src/types/index.js";

describe("TranscriptResult", () => {
  it("ausência de transcrição é um estado explícito, não string vazia", () => {
    const r: TranscriptResult = { status: "unavailable", reason: "no tracks" };
    expect("text" in r).toBe(false);
  });
});
