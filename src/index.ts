import "dotenv/config";
import { join } from "node:path";
import { runAiDiagnostics } from "./ai/ai-tester.js";
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
    const platforms = loadPlatformsConfig();
    const enabledPlatforms = Object.entries(platforms.platforms)
      .filter(([, p]) => p.enabled)
      .map(([name]) => name);
    console.log(
      [
        "Config OK",
        `  AI endpoint:    ${config.ai.baseUrl}`,
        `  AI model:       ${config.ai.model}`,
        `  AI temperature: ${config.ai.temperature}`,
        `  AI max tokens:  ${config.ai.maxTokens}`,
        `  AI chunk chars: ${config.ai.chunkChars}`,
        `  AI timeout:     ${config.ai.timeoutMs}ms`,
        `  AI max retries: ${config.ai.maxRetries}`,
        `  Platforms:      ${enabledPlatforms.join(", ") || "none"}`,
        `  Data dir:       ${config.dataDir}`,
        `  Output dir:     ${config.outputDir}`,
      ].join("\n"),
    );
    return;
  }

  const logger = createAppLogger(config.dataDir, config.logLevel);
  const ai = createAiProvider(config, logger);

  if (command === "test-ai") {
    const report = await runAiDiagnostics({
      config: config.ai,
      provider: ai,
      logger,
      out: (l) => console.log(l),
    });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  const platforms = loadPlatformsConfig();
  const db = openDatabase(join(config.dataDir, "database", "progress.sqlite"));
  const courses = new CourseRepository(db);
  const progress = new ProgressRepository(db);

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
