import { CliUsageError } from "../cli/errors.js";
import type { Lesson } from "../types/index.js";

export interface SelectionInput {
  lesson?: number;
  lessons?: string;
  from?: number;
  to?: number;
  all?: boolean;
}

export function hasSelection(i: SelectionInput): boolean {
  return (
    i.lesson !== undefined ||
    i.lessons !== undefined ||
    i.from !== undefined ||
    i.to !== undefined ||
    i.all === true
  );
}

/** Interpreta "1,3,5-7" em posições (começando em 1). */
export function parseNumberList(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b) throw new CliUsageError(`Invalid range "${part}": start is greater than end`);
      for (let n = a; n <= b; n++) out.push(n);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    } else {
      throw new CliUsageError(`Invalid lesson number "${part}"`);
    }
  }
  if (out.length === 0) throw new CliUsageError("No lesson numbers provided");
  return out;
}

/** Rejeita combinações conflitantes com mensagens claras (§15.2). */
export function validateSelectionInput(i: SelectionInput): void {
  const modes = [
    i.lesson !== undefined ? "--lesson" : undefined,
    i.lessons !== undefined ? "--lessons" : undefined,
    i.from !== undefined || i.to !== undefined ? "--from/--to" : undefined,
    i.all ? "--all" : undefined,
  ].filter(Boolean);
  if (modes.length > 1) {
    throw new CliUsageError(`Conflicting selection options: ${modes.join(" and ")}. Use only one.`);
  }
  for (const [flag, v] of [["--lesson", i.lesson], ["--from", i.from], ["--to", i.to]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 1)) {
      throw new CliUsageError(`${flag} must be an integer >= 1 (positions start at 1)`);
    }
  }
  if (i.from !== undefined && i.to !== undefined && i.from > i.to) {
    throw new CliUsageError(`--from (${i.from}) must not be greater than --to (${i.to})`);
  }
}

/** Resolve posições selecionadas (ordenadas, sem duplicatas) para um curso com `total` aulas. */
export function resolveSelection(i: SelectionInput, total: number): number[] {
  validateSelectionInput(i);
  if (total < 1) throw new CliUsageError("The course has no lessons");
  let positions: number[];
  if (i.all) positions = range(1, total);
  else if (i.lesson !== undefined) positions = [i.lesson];
  else if (i.lessons !== undefined) positions = parseNumberList(i.lessons);
  else if (i.from !== undefined || i.to !== undefined) positions = range(i.from ?? 1, i.to ?? total);
  else throw new CliUsageError("No lessons selected. Use --lesson, --lessons, --from/--to or --all.");

  const bad = positions.filter((p) => p < 1 || p > total);
  if (bad.length) {
    throw new CliUsageError(`Lesson number(s) out of range: ${[...new Set(bad)].join(", ")} (course has ${total} lessons)`);
  }
  return [...new Set(positions)].sort((a, b) => a - b);
}

export function selectLessons(lessons: Lesson[], positions: number[]): Lesson[] {
  const set = new Set(positions);
  return lessons.filter((l) => set.has(l.position));
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let n = a; n <= b; n++) out.push(n);
  return out;
}
