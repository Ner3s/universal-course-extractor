import { confirm, input, select } from "@inquirer/prompts";
import type { ConflictDecision, ConflictInfo } from "../../storage/writers/markdown-writer.js";
import type { Course, Lesson } from "../../types/index.js";

/** Interações com o usuário; substituível em testes. */
export interface Ui {
  input(message: string, defaultValue?: string): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  selectCourse(courses: Course[]): Promise<Course>;
  /** Retorna texto de seleção, ex.: "1,3,5-7" ou "all". */
  askLessonSelection(lessons: Lesson[]): Promise<string>;
  askConflict(info: ConflictInfo): Promise<ConflictDecision>;
}

export const inquirerUi: Ui = {
  input: (message, defaultValue) => input({ message, default: defaultValue }),
  confirm: (message, defaultValue = true) => confirm({ message, default: defaultValue }),
  selectCourse: (courses) =>
    select({
      message: "Qual curso processar?",
      choices: courses.map((c) => ({ name: `${c.title} (${c.lessons.length} aulas)`, value: c })),
    }),
  askLessonSelection: (_lessons) =>
    input({
      message: 'Quais aulas processar? (ex.: 1,3,5-7 ou "all")',
      default: "all",
    }),
  askConflict: (info) =>
    select<ConflictDecision>({
      message: `O arquivo já existe: ${info.path}${info.sameLesson ? " (mesma aula)" : ""}. O que fazer?`,
      choices: [
        { name: "Pular", value: "skip" },
        { name: "Sobrescrever", value: "overwrite" },
      ],
    }),
};
