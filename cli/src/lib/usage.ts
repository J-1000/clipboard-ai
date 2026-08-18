import { appendFile, chmod, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface ProviderUsageRecord {
  timestamp: string;
  action: string;
  profile: string;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface DailyProviderUsage {
  profileTokens: number;
  actionTokens: number;
}

export async function getDailyProviderUsage(
  profile: string,
  action: string,
  now = new Date()
): Promise<DailyProviderUsage> {
  const path = usageFile();
  if (!existsSync(path)) {
    return { profileTokens: 0, actionTokens: 0 };
  }

  const day = now.toISOString().slice(0, 10);
  const records = (await readFile(path, "utf8"))
    .split("\n")
    .flatMap((line): ProviderUsageRecord[] => {
      try {
        return line.trim() ? [JSON.parse(line) as ProviderUsageRecord] : [];
      } catch {
        return [];
      }
    });

  let profileTokens = 0;
  let actionTokens = 0;
  for (const record of records) {
    if (!record.timestamp.startsWith(day)) {
      continue;
    }
    const tokens = (record.prompt_tokens ?? 0) + (record.completion_tokens ?? 0);
    if (record.profile === profile) {
      profileTokens += tokens;
    }
    if (record.action === action) {
      actionTokens += tokens;
    }
  }
  return { profileTokens, actionTokens };
}

export async function appendProviderUsage(
  input: Omit<ProviderUsageRecord, "timestamp"> & { timestamp?: string }
): Promise<void> {
  if (input.prompt_tokens <= 0 && input.completion_tokens <= 0) {
    return;
  }
  const path = usageFile();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const record: ProviderUsageRecord = {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function usageFile(): string {
  return process.env.CBAI_USAGE_FILE ?? join(homedir(), ".clipboard-ai", "usage.jsonl");
}
