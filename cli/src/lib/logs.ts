import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface AgentLogOptions {
  tail?: number;
  file?: "out" | "err";
}

export function getAgentLogPath(file: "out" | "err" = "out"): string {
  const filename = file === "err" ? "agent.err" : "agent.log";
  const logDir = process.env.CBAI_LOG_DIR ?? join(homedir(), ".clipboard-ai");
  return join(logDir, filename);
}

export async function readAgentLogs(options: AgentLogOptions = {}): Promise<string[]> {
  const tail = options.tail ?? 100;
  if (!Number.isInteger(tail) || tail <= 0) {
    throw new Error("tail must be a positive integer");
  }

  const filePath = getAgentLogPath(options.file ?? "out");
  const data = await readFile(filePath, "utf8");
  const lines = data
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length <= tail) {
    return lines;
  }

  return lines.slice(lines.length - tail);
}
