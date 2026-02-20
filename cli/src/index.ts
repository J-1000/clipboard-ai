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
import { runCommand } from "./commands/run.js";
import { historyCommand } from "./commands/history.js";
import { rerunCommand } from "./commands/rerun.js";
import pkg from "../package.json" assert { type: "json" };

yargs(hideBin(process.argv))
  .scriptName("cbai")
  .usage("$0 <command> [options]")
  .option("yes", {
    alias: "y",
    type: "boolean",
    description: "Skip safe mode confirmation prompts",
    default: false,
  })
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
    "run <action> [args..]",
    "Run an action by name",
    (yargs) =>
      yargs
        .positional("action", {
          describe: "Action id or alias",
          type: "string",
        })
        .positional("args", {
          describe: "Action arguments",
          type: "string",
        })
        .option("copy", {
          alias: "c",
          type: "boolean",
          description: "Copy result to clipboard",
          default: false,
        }),
    async (argv) => {
      await runCommand(argv.action as string, {
        args: (argv.args as string[] | undefined) ?? [],
        copy: argv.copy,
        yes: argv.yes,
      });
    }
  )
  .command(
    "history",
    "Show recent action history",
    (yargs) =>
      yargs.option("limit", {
        alias: "n",
        type: "number",
        description: "Maximum number of history rows to show",
        default: 20,
      }),
    async (argv) => {
      await historyCommand({ limit: argv.limit });
    }
  )
  .command(
    "rerun <id>",
    "Replay a previous action run from history",
    (yargs) =>
      yargs
        .positional("id", {
          describe: "History run id",
          type: "string",
        })
        .option("copy", {
          alias: "c",
          type: "boolean",
          description: "Copy result to clipboard",
          default: false,
        }),
    async (argv) => {
      await rerunCommand(argv.id as string, { copy: argv.copy, yes: argv.yes });
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
      await summaryCommand({ copy: argv.copy, yes: argv.yes });
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
      await summaryCommand({ copy: argv.copy, yes: argv.yes });
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
      await explainCommand({ copy: argv.copy, yes: argv.yes });
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
      await translateCommand(argv.lang as string, { copy: argv.copy, yes: argv.yes });
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
      await improveCommand({ copy: argv.copy, yes: argv.yes });
    }
  )
  .command(
    "extract",
    "Extract structured data from clipboard",
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await extractCommand({ copy: argv.copy, yes: argv.yes });
    }
  )
  .command(
    "tldr",
    "Get a very brief summary (1-2 sentences)",
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await tldrCommand({ copy: argv.copy, yes: argv.yes });
    }
  )
  .command(
    "classify",
    "Classify clipboard content by type",
    (yargs) =>
      yargs.option("copy", {
        alias: "c",
        type: "boolean",
        description: "Copy result to clipboard",
        default: false,
      }),
    async (argv) => {
      await classifyCommand({ copy: argv.copy, yes: argv.yes });
    }
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .version(pkg.version)
  .strict()
  .parse();
