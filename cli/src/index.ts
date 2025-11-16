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
    () => {},
    async () => {
      await summaryCommand();
    }
  )
  .command(
    ["summarize", "sum"],
    false, // hidden alias
    () => {},
    async () => {
      await summaryCommand();
    }
  )
  .command(
    "explain",
    "Explain clipboard content (good for code)",
    () => {},
    async () => {
      await explainCommand();
    }
  )
  .command(
    "translate <lang>",
    "Translate clipboard to target language",
    (yargs) => {
      return yargs.positional("lang", {
        describe: "Target language",
        type: "string",
        default: "English",
      });
    },
    async (argv) => {
      await translateCommand(argv.lang as string);
    }
  )
  .command(
    "improve",
    "Improve writing in clipboard",
    () => {},
    async () => {
      await improveCommand();
    }
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .version("0.1.0")
  .strict()
  .parse();
