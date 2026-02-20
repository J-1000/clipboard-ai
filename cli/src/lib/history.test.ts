import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

let historyFile: string;

async function loadHistoryModule() {
  return import(`./history.js?test=${Date.now()}`);
}

describe("history store", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "cbai-history-test-"));
    historyFile = join(dir, "history.jsonl");
    process.env.CBAI_HISTORY_FILE = historyFile;
  });

  it("appends and reads records newest-first", async () => {
    const { appendHistoryRecord, readHistoryRecords } = await loadHistoryModule();

    await appendHistoryRecord({
      action: "summary",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 12,
      status: "success",
      copy: false,
      input: "one",
      output: "out one",
    });
    await appendHistoryRecord({
      action: "explain",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 8,
      status: "success",
      copy: false,
      input: "two",
      output: "out two",
    });

    const records = await readHistoryRecords();
    expect(records).toHaveLength(2);
    expect(records[0].action).toBe("explain");
    expect(records[1].action).toBe("summary");
  });

  it("reads by id", async () => {
    const { appendHistoryRecord, getHistoryRecordById } = await loadHistoryModule();
    const record = await appendHistoryRecord({
      action: "summary",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 10,
      status: "success",
      copy: false,
      input: "test",
      output: "done",
    });

    const found = await getHistoryRecordById(record.id);
    expect(found?.id).toBe(record.id);
  });

  it("supports limit", async () => {
    const { appendHistoryRecord, readHistoryRecords } = await loadHistoryModule();
    await appendHistoryRecord({
      action: "a",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 1,
      status: "success",
      copy: false,
      input: "a",
    });
    await appendHistoryRecord({
      action: "b",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 1,
      status: "success",
      copy: false,
      input: "b",
    });

    const records = await readHistoryRecords(1);
    expect(records).toHaveLength(1);
    expect(records[0].action).toBe("b");
  });

  it("writes jsonl", async () => {
    const { appendHistoryRecord } = await loadHistoryModule();
    await appendHistoryRecord({
      id: "run-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      action: "summary",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 10,
      status: "success",
      copy: false,
      input: "text",
    });

    expect(existsSync(historyFile)).toBe(true);
    const raw = readFileSync(historyFile, "utf8");
    expect(raw).toContain("\"id\":\"run-1\"");
  });
});
