#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { statusCommand } from "./commands/status.js";
import { clipboardCommand } from "./commands/clipboard.js";
import { configCommand } from "./commands/config.js";
import { summaryCommand } from "./commands/summary.js";
import { explainCommand } from "./commands/explain.js";
import { translateCommand } from "./commands/translate.js";
import { improveCommand } from "./commands/improve.js";
import { extractCommand } from "./commands/extract.js";
import { tldrCommand } from "./commands/tldr.js";
import { classifyCommand } from "./commands/classify.js";

yargs(hideBin(process.argv))
  .scriptName("cbai")
  .usage("$0 <command> [options]")
  .command(
    "status",
    "Show agent status",
    () => {},
    async () => {
      await statusCommand();
    }
  )
  .command(
    "clipboard",
    "Show current clipboard content",
    () => {},
    async () => {
      await clipboardCommand();
    }
  )
  .command(
    "config",
    "Show current configuration",
    () => {},
    async () => {
      await configCommand();
    }
  )
  .command(
    "summary",
    "Summarize clipboard content",
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await summaryCommand({ copy: argv.copy });
    }
  )
  .command(
    ["summarize", "sum"],
    false, // hidden alias
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await summaryCommand({ copy: argv.copy });
    }
  )
  .command(
    "explain",
    "Explain clipboard content (good for code)",
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await explainCommand({ copy: argv.copy });
    }
  )
  .command(
    "translate <lang>",
    "Translate clipboard to target language",
    (yargs) => {
      return yargs
        .positional("lang", {
          describe: "Target language",
          type: "string",
          default: "English",
        })
        .option("copy", {
          alias: "c",
          type: "boolean",
          description: "Copy result to clipboard",
          default: false,
        });
    },
    async (argv) => {
      await translateCommand(argv.lang as string, { copy: argv.copy });
    }
  )
  .command(
    "improve",
    "Improve writing in clipboard",
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await improveCommand({ copy: argv.copy });
    }
  )
  .command(
    "extract",
    "Extract structured data from clipboard",
    () => {},
    async () => {
      await extractCommand();
    }
  )
  .command(
    "tldr",
    "Get a very brief summary (1-2 sentences)",
    () => {},
    async () => {
      await tldrCommand();
    }
  )
  .command(
    "classify",
    "Classify clipboard content by type",
    () => {},
    async () => {
      await classifyCommand();
    }
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .version("0.1.0")
  .strict()
  .parse();
