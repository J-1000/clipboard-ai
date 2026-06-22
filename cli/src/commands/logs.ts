import { readAgentLogs } from "../lib/logs.js";

export interface LogsCommandOptions {
  tail?: number;
  file?: "out" | "err";
}

export async function logsCommand(options: LogsCommandOptions = {}): Promise<void> {
  // Defensive: only "out"/"err" select a log file; anything else falls back to "out".
  const file: "out" | "err" = options.file === "err" ? "err" : "out";

  try {
    const lines = await readAgentLogs({ ...options, file });

    if (lines.length === 0) {
      console.log("No log entries found.");
      return;
    }

    for (const line of lines) {
      console.log(line);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
