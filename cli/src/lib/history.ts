import { mkdir, appendFile, chmod, open, readFile, rename, stat, unlink, writeFile } from "fs/promises";
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
  prompt_tokens?: number;
  completion_tokens?: number;
}

export type ActionRunRecordInput = Omit<ActionRunRecord, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export interface HistoryRetentionSettings {
  history_enabled?: boolean;
  history_max_entries?: number;
  history_truncate_chars?: number;
}

export async function appendHistoryRecord(
  input: ActionRunRecordInput,
  settings: HistoryRetentionSettings = {}
): Promise<ActionRunRecord> {
  const record: ActionRunRecord = {
    ...input,
    id: input.id ?? generateId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };

  if (settings.history_enabled === false) {
    return record;
  }

  const storedRecord = truncateRecord(record, settings.history_truncate_chars);
  const historyFile = getHistoryFile();
  await mkdir(dirname(historyFile), { recursive: true, mode: 0o700 });
  // Serialize append + compaction so a concurrent compaction's read-modify-write
  // can't clobber this append (and vice versa).
  await withHistoryLock(historyFile, async () => {
    await appendFile(historyFile, `${JSON.stringify(storedRecord)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(historyFile, 0o600);
    await compactHistoryFile(historyFile, settings.history_max_entries);
  });
  return storedRecord;
}

export async function readHistoryRecords(limit?: number): Promise<ActionRunRecord[]> {
  const historyFile = getHistoryFile();
  if (!existsSync(historyFile)) {
    return [];
  }

  const data = await readFile(historyFile, "utf8");
  const records: ActionRunRecord[] = [];
  let corruptCount = 0;

  for (const line of data.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed) as ActionRunRecord);
    } catch {
      corruptCount += 1;
    }
  }

  if (corruptCount > 0) {
    console.error(`Warning: skipped ${corruptCount} corrupt history entr${corruptCount === 1 ? "y" : "ies"}`);
  }

  records.reverse();

  if (limit !== undefined && limit >= 0) {
    return records.slice(0, limit);
  }

  return records;
}

export async function getHistoryRecordById(id: string): Promise<ActionRunRecord | null> {
  const records = await readHistoryRecords();
  return records.find((record) => record.id === id) ?? null;
}

export async function clearHistoryRecords(): Promise<void> {
  const historyFile = getHistoryFile();
  if (!existsSync(historyFile)) {
    return;
  }
  await unlink(historyFile);
}

export async function pruneHistoryBefore(before: Date): Promise<number> {
  const historyFile = getHistoryFile();
  if (!existsSync(historyFile)) {
    return 0;
  }

  return withHistoryLock(historyFile, async () => {
    const data = await readFile(historyFile, "utf8");
    const cutoff = before.getTime();
    const kept: string[] = [];
    let removed = 0;

    for (const line of data.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      try {
        const record = JSON.parse(trimmed) as ActionRunRecord;
        const timestamp = Date.parse(record.timestamp);
        if (!Number.isNaN(timestamp) && timestamp < cutoff) {
          removed += 1;
          continue;
        }
      } catch {
        // Corrupt-line handling is covered separately; pruning preserves unknown lines.
      }

      kept.push(trimmed);
    }

    const nextData = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
    await writeFileAtomic(historyFile, nextData);
    return removed;
  });
}

function generateId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`;
}

function getHistoryFile(): string {
  return process.env.CBAI_HISTORY_FILE ?? join(homedir(), ".clipboard-ai", "history.jsonl");
}

function truncateRecord(
  record: ActionRunRecord,
  truncateChars: number | undefined
): ActionRunRecord {
  if (truncateChars === undefined || truncateChars === 0) {
    return record;
  }

  return {
    ...record,
    input: truncateCharsFromString(record.input, truncateChars),
    output:
      record.output === undefined
        ? undefined
        : truncateCharsFromString(record.output, truncateChars),
  };
}

function truncateCharsFromString(value: string, maxChars: number): string {
  if (maxChars < 0) {
    return value;
  }

  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }

  return chars.slice(0, maxChars).join("");
}

async function compactHistoryFile(
  historyFile: string,
  maxEntries: number | undefined
): Promise<void> {
  if (maxEntries === undefined || maxEntries < 0 || !existsSync(historyFile)) {
    return;
  }

  const data = await readFile(historyFile, "utf8");
  const lines = data.split("\n").filter((line) => line.trim().length > 0);
  const compactThreshold = Math.floor(maxEntries * 1.1);
  if (lines.length <= compactThreshold) {
    return;
  }

  const kept = maxEntries === 0 ? [] : lines.slice(-maxEntries);
  const nextData = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
  await writeFileAtomic(historyFile, nextData);
}

// writeFileAtomic writes to a temp file then renames over the target, so a
// reader never sees a half-written history file.
async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600);
}

const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 30_000;

// withHistoryLock serializes mutators via an O_EXCL lockfile. On contention it
// retries briefly; a lock older than LOCK_STALE_MS (orphaned by a crash) is
// stolen, and if a slot still can't be acquired it proceeds best-effort rather
// than losing the write entirely.
async function withHistoryLock<T>(historyFile: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${historyFile}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        return await fn();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => {});
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
      await stealIfStale(lockPath);
      if (Date.now() > deadline) {
        // Couldn't acquire in time; run anyway so the record isn't dropped.
        return fn();
      }
      await sleep(20);
    }
  }
}

async function stealIfStale(lockPath: string): Promise<void> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
      await unlink(lockPath).catch(() => {});
    }
  } catch {
    // Lock vanished — fine, the next attempt will acquire it.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
