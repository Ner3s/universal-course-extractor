import "dotenv/config";
import { Command } from "commander";
import { loadAppConfig } from "./config/config.loader.js";
import { createLogger } from "./config/logger.js";

const program = new Command();
program
  .name("scrape")
  .description("Universal Course Knowledge Extractor")
  .version("0.1.0");

program
  .command("check-config")
  .description("Valida a configuração (.env) e imprime um resumo sem segredos")
  .action(() => {
    const config = loadAppConfig();
    const logger = createLogger(config.logLevel);
    logger.info(
      { baseUrl: config.ai.baseUrl, model: config.ai.model, outputDir: config.outputDir },
      "Configuração válida",
    );
  });

await program.parseAsync(process.argv);
