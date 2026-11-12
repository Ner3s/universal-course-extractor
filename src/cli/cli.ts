import { Command, InvalidArgumentError } from "commander";
import type { ScrapeOptions } from "./options.js";

export type CommandName = "scrape" | "auth" | "courses" | "lessons" | "resume" | "check-config";
export type CommandRunner = (command: CommandName, options: ScrapeOptions) => Promise<void>;

function int(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("must be a positive integer");
  return Number(value);
}

function addOptions(cmd: Command): Command {
  return cmd
    .option("--url <url>", "course or platform URL")
    .option("--platform <name>", "force a platform adapter (e.g. skilljar, generic)")
    .option("--course <name>", "course name")
    .option("--lesson <number>", "process a single lesson (position starting at 1)", int)
    .option("--lessons <numbers>", 'process specific lessons, e.g. "1,3,5-7"')
    .option("--from <number>", "first lesson of a range", int)
    .option("--to <number>", "last lesson of a range", int)
    .option("--all", "process the whole course")
    .option("--output <path>", "output directory (e.g. an Obsidian vault folder)")
    .option("--overwrite", "reprocess and overwrite existing files")
    .option("--skip-existing", "skip lessons whose final file already exists")
    .option("--dry-run", "show what would be processed without doing it")
    .option("--headed", "show the browser window")
    .option("--headless", "run the browser without a window")
    .option("-y, --yes", "non-interactive: do not ask for confirmation");
}

/** Constrói o programa Commander; `run` executa o comando (injetável em testes). */
export function createProgram(run: CommandRunner): Command {
  const program = new Command();
  program
    .name("scrape")
    .description("Universal Course Knowledge Extractor")
    .version("0.1.0")
    .enablePositionalOptions();

  addOptions(program).action(async (opts: ScrapeOptions) => run("scrape", opts));

  const sub = (name: Exclude<CommandName, "scrape">, description: string) =>
    addOptions(program.command(name).description(description)).action(async (opts: ScrapeOptions) =>
      run(name, opts),
    );

  sub("auth", "authenticate manually and save the browser session");
  sub("courses", "discover available courses");
  sub("lessons", "list the lessons of a course (use --course)");
  sub("resume", "resume interrupted or failed processing");
  program
    .command("check-config")
    .description("validate .env configuration and print a summary without secrets")
    .action(async () => run("check-config", {}));

  return program;
}
