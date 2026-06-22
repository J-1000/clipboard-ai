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
import { captionCommand } from "./commands/caption.js";
import { ocrCommand } from "./commands/ocr.js";
import { runCommand } from "./commands/run.js";
import { actionsCommand } from "./commands/actions.js";
import { doctorCommand } from "./commands/doctor.js";
import { historyCommand } from "./commands/history.js";
import { rerunCommand } from "./commands/rerun.js";
import { logsCommand } from "./commands/logs.js";
import { VERSION } from "./version.js";
import type { Argv } from "yargs";

// Flags scoped to action-running commands only (not global), so read-only
// commands' help isn't cluttered with --yes/--force.
function runFlags<T>(yargs: Argv<T>) {
  return yargs
    .option("copy", {
      alias: "c",
      type: "boolean",
      description: "Copy result to clipboard",
      default: false,
    })
    .option("yes", {
      alias: "y",
      type: "boolean",
      description: "Skip safe mode confirmation prompts",
      default: false,
    })
    .option("force", {
      type: "boolean",
      description: "Bypass sensitive-data guard for manual actions",
      default: false,
    });
}

yargs(hideBin(process.argv))
  .scriptName("cbai")
  .usage("$0 <command> [options]")
  // Tokens after `--` are captured in argv["--"] instead of being parsed as
  // options. The daemon spawns `cbai run <action> -- <args...>` so an attacker
  // can't smuggle a global flag (e.g. --force) through clipboard-derived args.
  .parserConfiguration({ "populate--": true })
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
    "actions",
    "List registered actions",
    () => {},
    async () => {
      await actionsCommand();
    }
  )
  .command(
    "doctor",
    "Run diagnostics",
    () => {},
    async () => {
      await doctorCommand();
    }
  )
  .command(
    "run <action> [args..]",
    "Run an action by name",
    (yargs) =>
      runFlags(
        yargs
          .positional("action", {
            describe: "Action id or alias",
            type: "string",
          })
          .positional("args", {
            describe: "Action arguments",
            type: "string",
          })
      ),
    async (argv) => {
      const positional = (argv.args as string[] | undefined) ?? [];
      const afterDashDash = (argv["--"] as string[] | undefined) ?? [];
      await runCommand(argv.action as string, {
        args: [...positional, ...afterDashDash],
        copy: argv.copy,
        yes: argv.yes,
        force: argv.force,
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
      })
        .option("clear", {
          type: "boolean",
          description: "Delete all history records",
          default: false,
        })
        .option("before", {
          type: "string",
          description: "Delete history records before an ISO date",
        }),
    async (argv) => {
      await historyCommand({
        limit: argv.limit,
        clear: argv.clear,
        before: argv.before,
      });
    }
  )
  .command(
    "rerun <id>",
    "Replay a previous action run from history",
    (yargs) =>
      runFlags(
        yargs.positional("id", {
          describe: "History run id",
          type: "string",
        })
      ),
    async (argv) => {
      await rerunCommand(argv.id as string, { copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "logs",
    "Show agent logs",
    (yargs) =>
      yargs
        .option("tail", {
          alias: "n",
          type: "number",
          description: "Number of recent log lines to show",
          default: 100,
        })
        .option("file", {
          choices: ["out", "err"] as const,
          description: "Select output or error log file",
          default: "out" as const,
        }),
    async (argv) => {
      await logsCommand({ tail: argv.tail, file: argv.file });
    }
  )
  .command(
    "summary",
    "Summarize clipboard content",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await summaryCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    ["summarize", "sum"],
    false, // hidden alias
    (yargs) => runFlags(yargs),
    async (argv) => {
      await summaryCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "explain",
    "Explain clipboard content (good for code)",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await explainCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "translate [lang]",
    "Translate clipboard to target language (defaults to English)",
    (yargs) =>
      runFlags(
        yargs.positional("lang", {
          describe: "Target language",
          type: "string",
          default: "English",
        })
      ),
    async (argv) => {
      await translateCommand(argv.lang as string, { copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "improve",
    "Improve writing in clipboard",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await improveCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "extract",
    "Extract structured data from clipboard",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await extractCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "tldr",
    "Get a very brief summary (1-2 sentences)",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await tldrCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "classify",
    "Classify clipboard content by type",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await classifyCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "caption",
    "Generate a caption for a clipboard image",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await captionCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .command(
    "ocr",
    "Extract text from a clipboard image",
    (yargs) => runFlags(yargs),
    async (argv) => {
      await ocrCommand({ copy: argv.copy, yes: argv.yes, force: argv.force });
    }
  )
  .demandCommand(1, "Please specify a command")
  .example("$0 summary", "Summarize the current clipboard")
  .example("$0 translate Spanish", "Translate the clipboard to Spanish")
  .example("$0 run <action>", "Run any registered action")
  .example("$0 caption", "Caption an image on the clipboard")
  .epilogue(
    "List actions with `cbai actions`; run any of them with `cbai run <action>`.\n" +
      "Check your setup with `cbai doctor`."
  )
  .help()
  .version(VERSION)
  .strict()
  .parse();
