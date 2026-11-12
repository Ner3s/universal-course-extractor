/**
 * Divide texto em chunks de no máximo `maxChars`, respeitando limites semânticos:
 * parágrafos primeiro, depois sentenças, por último palavras. A ordem é preservada
 * e `chunks.join` não perde conteúdo (exceto espaços nas fronteiras).
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (maxChars < 1) throw new Error("maxChars must be positive");
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const units: string[] = [];
  for (const para of trimmed.split(/\n{2,}/)) {
    if (para.length <= maxChars) units.push(para);
    else units.push(...splitLong(para, maxChars));
  }

  const chunks: string[] = [];
  let current = "";
  for (const u of units) {
    const candidate = current ? `${current}\n\n${u}` : u;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = u;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLong(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$|\n/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const s of sentences) {
    if (s.length > maxChars) {
      flush();
      out.push(...splitWords(s, maxChars));
    } else if ((cur + s).length > maxChars) {
      flush();
      cur = s;
    } else {
      cur += s;
    }
  }
  flush();
  return out;
}

function splitWords(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if (w.length > maxChars) {
      if (cur) out.push(cur);
      cur = "";
      for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars));
      continue;
    }
    if ((cur ? cur.length + 1 : 0) + w.length > maxChars) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Placeholder para blocos de código (nunca enviados ao modelo). */
export const codePlaceholder = (n: number) => `[[[CODE_BLOCK_${n}]]]`;

export interface ProtectedMarkdown {
  text: string;
  blocks: string[];
}

/** Substitui blocos de código cercados (``` ou ~~~) por placeholders. */
export function protectCodeBlocks(markdown: string): ProtectedMarkdown {
  const blocks: string[] = [];
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: { marker: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (!fence) {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (m) {
        fence = { marker: m[1]!, lines: [line] };
      } else {
        out.push(line);
      }
    } else {
      fence.lines.push(line);
      const closing = new RegExp(`^\\s{0,3}${fence.marker[0] === "`" ? "`" : "~"}{${fence.marker.length},}\\s*$`);
      if (closing.test(line)) {
        out.push(codePlaceholder(blocks.length));
        blocks.push(fence.lines.join("\n"));
        fence = null;
      }
    }
  }
  if (fence) {
    // Bloco não fechado: trata o resto como código para não corromper.
    out.push(codePlaceholder(blocks.length));
    blocks.push(fence.lines.join("\n"));
  }
  return { text: out.join("\n"), blocks };
}

export function restoreCodeBlocks(text: string, blocks: string[]): string {
  return text.replace(/\[\[\[CODE_BLOCK_(\d+)\]\]\]/g, (m, n: string) => blocks[Number(n)] ?? m);
}

/**
 * Divide Markdown em chunks sem quebrar tabelas nem listas no meio de um item.
 * Opera sobre texto já protegido (sem blocos de código).
 */
export function chunkMarkdown(markdown: string, maxChars: number): string[] {
  const blocks = markdown.trim().split(/\n{2,}/);
  const units: string[] = [];
  for (const b of blocks) {
    const isTable = b.split("\n").every((l) => l.trim().startsWith("|"));
    if (b.length <= maxChars || isTable) units.push(b);
    else units.push(...chunkText(b, maxChars));
  }
  const chunks: string[] = [];
  let current = "";
  for (const u of units) {
    const candidate = current ? `${current}\n\n${u}` : u;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      chunks.push(current);
      current = u;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 0);
}
