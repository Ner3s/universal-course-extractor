import "dotenv/config";
import { join } from "node:path";
import { createProgram, type CommandName } from "./cli/cli.js";
import { CliUsageError } from "./cli/errors.js";
import type { ScrapeOptions } from "./cli/options.js";
import { inquirerUi } from "./cli/prompts/prompts.js";
import { loadAppConfig, loadPlatformsConfig } from "./config/config.loader.js";
import { createAppLogger } from "./config/logger.js";
import { Orchestrator } from "./core/orchestrator.js";
import { createAiProvider, createProcessorFactory } from "./core/pipeline.js";
import { createPlatformResolver } from "./platforms/runtime.js";
import { openDatabase } from "./storage/database.js";
import { CourseRepository } from "./storage/repositories/course.repository.js";
import { ProgressRepository } from "./storage/repositories/progress.repository.js";

async function run(command: CommandName, options: ScrapeOptions): Promise<void> {
  const config = loadAppConfig();

  if (command === "check-config") {
    console.log(
      `Config OK\n  AI endpoint: ${config.ai.baseUrl}\n  AI model: ${config.ai.model}\n  Data dir: ${config.dataDir}\n  Output dir: ${config.outputDir}`,
    );
    return;
  }

  const logger = createAppLogger(config.dataDir, config.logLevel);
  const platforms = loadPlatformsConfig();
  const db = openDatabase(join(config.dataDir, "database", "progress.sqlite"));
  const courses = new CourseRepository(db);
  const progress = new ProgressRepository(db);
  const ai = createAiProvider(config, logger);

  // Ctrl+C: finaliza a aula atual e salva o progresso; segundo Ctrl+C encerra.
  const abort = new AbortController();
  process.on("SIGINT", () => {
    if (abort.signal.aborted) process.exit(130);
    console.log("\nInterrupt received: finishing the current lesson, then stopping (Ctrl+C again to force quit)...");
    abort.abort();
  });

  logger.info({ command }, "Starting");
  const orchestrator = new Orchestrator({
    config,
    logger,
    ui: inquirerUi,
    out: (l) => console.log(l),
    platforms: createPlatformResolver(config, platforms, logger),
    courses,
    progress,
    ai,
    createProcessor: createProcessorFactory(config, logger, progress, ai),
    signal: abort.signal,
  });

  try {
    switch (command) {
      case "auth":
        await orchestrator.auth(options);
        break;
      case "courses":
        await orchestrator.listCourses(options);
        break;
      case "lessons":
        await orchestrator.listLessons(options);
        break;
      case "resume":
        await orchestrator.resume(options);
        break;
      case "scrape": {
        const summary = await orchestrator.scrape(options);
        if (summary && summary.failed > 0) process.exitCode = 1;
        break;
      }
    }
  } finally {
    db.close();
  }
}

try {
  await createProgram(run).parseAsync(process.argv);
} catch (err) {
  if (err instanceof CliUsageError) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
