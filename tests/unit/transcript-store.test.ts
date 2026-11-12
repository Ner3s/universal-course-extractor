import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TranscriptStore, safeFileId } from "../../src/extraction/transcript-store.js";
import type { Lesson } from "../../src/types/index.js";

const lesson: Lesson = {
  id: "h.com/c/l1",
  platform: "skilljar",
  courseId: "c",
  title: "T",
  url: "https://h.com/c/l1",
  position: 1,
};

describe("TranscriptStore", () => {
  it("sanitiza ids", () => {
    expect(safeFileId("h.com/c/l1?x=1")).toBe("h.com_c_l1_x_1");
  });
  it("salva texto, metadados e segmentos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ts-"));
    const store = new TranscriptStore(dir);
    const p = await store.save(lesson, {
      status: "partial", text: "hello", source: "text-track", complete: false,
      segments: [{ start: 0, end: 1, text: "hello" }], warnings: ["w"],
    });
    expect(await readFile(p!, "utf8")).toBe("hello");
    const files = await readdir(join(dir, "skilljar"));
    expect(files.sort()).toEqual(["h.com_c_l1.meta.json", "h.com_c_l1.segments.json", "h.com_c_l1.txt"]);
    const meta = JSON.parse(await readFile(join(dir, "skilljar", "h.com_c_l1.meta.json"), "utf8"));
    expect(meta.complete).toBe(false);
    expect(meta.warnings).toEqual(["w"]);
  });
  it("não salva quando indisponível", async () => {
    const store = new TranscriptStore(await mkdtemp(join(tmpdir(), "ts-")));
    expect(await store.save(lesson, { status: "unavailable", reason: "x" })).toBeUndefined();
  });
});
