import { mkdir, appendFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type RunSource = "manual" | "daemon" | "rerun";
export type RunStatus = "success" | "error";

export interface ActionRunRecord {
  id: string;
  timestamp: string;
  action: string;
  args: string[];
  source: RunSource;
  trigger: string;
  provider: string;
  model: string;
  latency_ms: number;
  status: RunStatus;
  copy: boolean;
  input: string;
  output?: string;
  error?: string;
  replay_of?: string;
}

export type ActionRunRecordInput = Omit<ActionRunRecord, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export async function appendHistoryRecord(input: ActionRunRecordInput): Promise<ActionRunRecord> {
  const record: ActionRunRecord = {
    ...input,
    id: input.id ?? generateId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };

  const historyFile = getHistoryFile();
  await mkdir(dirname(historyFile), { recursive: true });
  await appendFile(historyFile, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readHistoryRecords(limit?: number): Promise<ActionRunRecord[]> {
  const historyFile = getHistoryFile();
  if (!existsSync(historyFile)) {
    return [];
  }

  const data = await readFile(historyFile, "utf8");
  const records = data
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ActionRunRecord)
    .reverse();

  if (limit !== undefined && limit >= 0) {
    return records.slice(0, limit);
  }

  return records;
}

export async function getHistoryRecordById(id: string): Promise<ActionRunRecord | null> {
  const records = await readHistoryRecords();
  return records.find((record) => record.id === id) ?? null;
}

function generateId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`;
}

function getHistoryFile(): string {
  return process.env.CBAI_HISTORY_FILE ?? join(homedir(), ".clipboard-ai", "history.jsonl");
}
