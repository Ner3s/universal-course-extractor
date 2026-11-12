import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export interface HtmlToMarkdownResult {
  markdown: string;
  /** Elementos removidos pela sanitização ou conversões com perda. */
  warnings: string[];
}

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img", "h1", "h2", "figure", "figcaption", "details", "summary", "del", "ins", "input",
];

/** Sanitiza o HTML (§17): remove scripts, estilos, iframes, handlers inline etc. */
export function sanitizeLessonHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
      code: ["class"],
      pre: ["class"],
      th: ["align", "colspan", "rowspan"],
      td: ["align", "colspan", "rowspan"],
      ol: ["start"],
      input: ["type", "checked", "disabled"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowedClasses: { code: [/^language-[\w+-]+$/], pre: [/^language-[\w+-]+$/] },
    // Mantém o texto de tags não permitidas, exceto conteúdo executável/estilo.
    disallowedTagsMode: "discard",
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  });
}

function tagNames(html: string): Set<string> {
  return new Set([...html.matchAll(/<([a-z][a-z0-9-]*)/gi)].map((m) => m[1]!.toLowerCase()));
}

function createService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    hr: "---",
  });
  td.use(gfm);

  // <pre> sem <code>: Turndown padrão não gera bloco cercado; preserva como código.
  td.addRule("bare-pre", {
    filter: (node) =>
      node.nodeName === "PRE" && !Array.from(node.childNodes).some((c) => c.nodeName === "CODE"),
    replacement: (_content, node) => `\n\n\`\`\`\n${node.textContent ?? ""}\n\`\`\`\n\n`,
  });

  // Imagens: preserva alt text; sem alt, mantém marcador explícito em vez de descartar.
  td.addRule("img-keep", {
    filter: "img",
    replacement: (_c, node) => {
      const el = node as unknown as { getAttribute(n: string): string | null };
      const src = el.getAttribute("src") ?? "";
      if (!src) return "";
      const alt = (el.getAttribute("alt") ?? "").replace(/[\[\]]/g, "");
      const title = el.getAttribute("title");
      return `![${alt}](${src}${title ? ` "${title.replace(/"/g, "'")}"` : ""})`;
    },
  });

  td.addRule("details", {
    filter: ["details"],
    replacement: (content) => `\n\n${content}\n\n`,
  });
  td.addRule("summary", {
    filter: ["summary"],
    replacement: (content) => `\n\n**${content.trim()}**\n\n`,
  });
  return td;
}

export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const warnings: string[] = [];
  const clean = sanitizeLessonHtml(html);
  const before = tagNames(html);
  const after = tagNames(clean);
  const dropped = [...before].filter((t) => !after.has(t) && !["html", "body", "head"].includes(t));
  if (dropped.length) warnings.push(`Elements removed by sanitization: ${dropped.sort().join(", ")}`);

  const markdown = createService()
    .turndown(clean)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!markdown && html.trim()) warnings.push("Conversion produced empty Markdown from non-empty HTML");
  return { markdown, warnings };
}
