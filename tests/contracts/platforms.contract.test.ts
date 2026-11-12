import { describe } from "vitest";
import pino from "pino";
import type { Page } from "playwright";
import { runAdapterContract } from "./adapter-contract.js";
import { SkilljarAdapter } from "../../src/platforms/skilljar/skilljar.adapter.js";
import { GenericAdapter } from "../../src/platforms/generic/generic.adapter.js";
import { platformConfigSchema } from "../../src/config/config.schema.js";
import type { TranscriptExtractor } from "../../src/extraction/transcript-extractor.js";

function createFakePage(currentUrl = "https://anthropic-partners.skilljar.com/course"): Page {
  let url = currentUrl;
  return {
    url: () => url,
    goto: async (target: string) => {
      url = target;
      return null;
    },
    title: async () => "Anthropic Partner Academy",
    waitForSelector: async () => ({}) as never,
    $$eval: async () => [
      { href: "https://anthropic-partners.skilljar.com/course/lesson-1", text: "Lesson 1" },
      { href: "https://anthropic-partners.skilljar.com/course/lesson-2", text: "Lesson 2" },
    ],
    locator: (sel: string) =>
      ({
        count: async () => (sel === "video.jw-video" ? 0 : 1),
        first: () => ({
          waitFor: async () => undefined,
          textContent: async () => "Lesson 1 Title",
          innerHTML: async () => "<p>Lesson content</p>",
          innerText: async () => "Transcript text",
        }),
      }) as never,
    evaluate: async () => null,
  } as unknown as Page;
}

const logger = pino({ level: "silent" });
const stubTranscriptEngine = {
  extract: async () => ({
    status: "found" as const,
    text: "Transcript content.",
    source: "text-track" as const,
    complete: true,
  }),
} as unknown as TranscriptExtractor;

describe("Platform Adapter Contracts", () => {
  runAdapterContract("SkilljarAdapter", {
    create: () => {
      const page = createFakePage();
      const adapter = new SkilljarAdapter(["anthropic-partners.skilljar.com"], {
        browserManager: {
          sessions: { exists: () => true },
          saveSession: async () => undefined,
        } as never,
        waitForUserConfirmation: async () => undefined,
        transcriptExtractor: stubTranscriptEngine,
      });
      adapter.setStartUrl("https://anthropic-partners.skilljar.com/course");
      void adapter.initialize({
        browser: {} as never,
        page,
        logger,
        config: platformConfigSchema.parse({
          domains: ["anthropic-partners.skilljar.com"],
          selectors: {
            lesson_links: "#curriculum-list-2 a",
            lesson_title: ".lesson-top > h2",
            lesson_content: "#details-pane-summary-content",
            video: "video.jw-video",
          },
        }),
      });
      return adapter;
    },
    supportedUrl: "https://anthropic-partners.skilljar.com/course",
    unsupportedUrl: "https://udemy.com/course",
  });

  runAdapterContract("GenericAdapter", {
    create: () => {
      const page = createFakePage("https://generic.example.com/course");
      const adapter = new GenericAdapter();
      adapter.setStartUrl("https://generic.example.com/course");
      void adapter.initialize({
        browser: {} as never,
        page,
        logger,
        config: platformConfigSchema.parse({
          selectors: {
            lesson_links: "a.lesson",
            lesson_title: "h1",
            lesson_content: "article",
            video: "video",
          },
        }),
      });
      return adapter;
    },
    supportedUrl: "https://generic.example.com/course",
    unsupportedUrl: "ftp://invalid.example.com/course",
  });
});
