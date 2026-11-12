import { describe, it, expect } from "vitest";
import pino from "pino";
import {
  assessCoverage,
  normalizeSegments,
  segmentsToText,
} from "../../src/extraction/transcript-integrity.js";
import {
  cuesToSegments,
  pickBestTrack,
  stripCueMarkup,
} from "../../src/extraction/text-tracks.js";
import { snapshotToResult } from "../../src/extraction/strategies/snapshot-result.js";
import { TranscriptExtractor } from "../../src/extraction/transcript-extractor.js";
import type { TranscriptStrategy } from "../../src/extraction/strategy.js";
import type { TranscriptResult } from "../../src/types/index.js";

const seg = (start: number, end: number, text = "x") => ({ start, end, text });

describe("assessCoverage", () => {
  it("completa com cobertura total", () => {
    const r = assessCoverage([seg(0, 50), seg(50, 100)], 100);
    expect(r.complete).toBe(true);
    expect(r.coverage).toBe(1);
  });
  it("parcial quando termina bem antes do fim", () => {
    const r = assessCoverage([seg(0, 40)], 100);
    expect(r.complete).toBe(false);
    expect(r.warnings.join()).toMatch(/ends/);
  });
  it("detecta lacuna grande", () => {
    const r = assessCoverage([seg(0, 10), seg(200, 300)], 300);
    expect(r.complete).toBe(false);
    expect(r.warnings.join()).toMatch(/missing/);
  });
  it("nunca é completa sem duração", () => {
    expect(assessCoverage([seg(0, 10)], undefined).complete).toBe(false);
  });
  it("nunca é completa sem tempos", () => {
    expect(assessCoverage([{ text: "a" }], 100).complete).toBe(false);
  });
  it("vazia não é completa", () => {
    expect(assessCoverage([], 100).complete).toBe(false);
  });
});

describe("normalizeSegments", () => {
  it("remove vazios e duplicatas e ordena", () => {
    const out = normalizeSegments([seg(5, 6, "b"), seg(0, 1, "  a  "), seg(0, 1, "a"), seg(2, 3, " ")]);
    expect(out.map((s) => s.text)).toEqual(["a", "b"]);
    expect(segmentsToText(out)).toBe("a\nb");
  });
});

describe("text tracks", () => {
  it("remove marcação de cue", () => {
    expect(stripCueMarkup("<c.x>Hello</c> <00:00:01.000>world")).toBe("Hello world");
  });
  it("converte cues e escolhe a faixa com mais cues", () => {
    const a = { kind: "captions", label: "a", language: "pt", mode: "hidden", cues: [{ start: 0, end: 1, text: "a" }] };
    const b = { kind: "captions", label: "b", language: "en", mode: "hidden", cues: [{ start: 0, end: 1, text: "a" }, { start: 1, end: 2, text: "b" }] };
    expect(pickBestTrack([a, b])?.label).toBe("b");
    expect(cuesToSegments(b.cues)).toHaveLength(2);
    expect(pickBestTrack([{ ...a, cues: [] }])).toBeUndefined();
  });
  it("snapshotToResult retorna found/partial conforme cobertura", () => {
    const track = (end: number) => ({
      kind: "captions", label: "en", language: "en", mode: "hidden",
      cues: [{ start: 0, end, text: "hello" }],
    });
    expect(snapshotToResult({ duration: 100, tracks: [track(100)] }, "text-track")?.status).toBe("found");
    const partial = snapshotToResult({ duration: 100, tracks: [track(20)] }, "text-track");
    expect(partial?.status).toBe("partial");
    expect(snapshotToResult({ tracks: [] }, "text-track")).toBeNull();
  });
});

describe("TranscriptExtractor", () => {
  const logger = pino({ level: "silent" });
  const ctx = { page: {} as never, logger, selectors: {} };
  const strat = (name: string, r: TranscriptResult | null | Error): TranscriptStrategy => ({
    name,
    extract: async () => {
      if (r instanceof Error) throw r;
      return r;
    },
  });
  const partial = (text: string): TranscriptResult => ({
    status: "partial", text, source: "text-track", complete: false,
  });

  it("retorna o primeiro resultado completo", async () => {
    const found: TranscriptResult = { status: "found", text: "ok", source: "native", complete: true };
    const r = await new TranscriptExtractor([strat("a", null), strat("b", found), strat("c", partial("zzz"))]).extract(ctx);
    expect(r.status).toBe("found");
  });
  it("prefere o parcial mais longo quando não há completo", async () => {
    const r = await new TranscriptExtractor([strat("a", partial("a")), strat("b", partial("abcd"))]).extract(ctx);
    expect(r.status === "partial" && r.text).toBe("abcd");
  });
  it("registra falhas de estratégias como warnings no parcial", async () => {
    const r = await new TranscriptExtractor([strat("a", new Error("boom")), strat("b", partial("x"))]).extract(ctx);
    expect(r.status === "partial" && r.warnings?.join()).toMatch(/boom/);
  });
  it("indisponível quando nenhuma estratégia se aplica", async () => {
    expect((await new TranscriptExtractor([strat("a", null)]).extract(ctx)).status).toBe("unavailable");
  });
  it("failed quando só há erros", async () => {
    expect((await new TranscriptExtractor([strat("a", new Error("x"))]).extract(ctx)).status).toBe("failed");
  });
  it("sinaliza necessidade de speech recognition", async () => {
    const sp: TranscriptResult = { status: "needs-speech-recognition", reason: "r" };
    expect((await new TranscriptExtractor([strat("a", null), strat("s", sp)]).extract(ctx)).status).toBe("needs-speech-recognition");
  });
});
