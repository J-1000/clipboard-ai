import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

let historyFile: string;

async function loadHistoryModule(): Promise<typeof import("./history.js")> {
  return import(`./history.js?test=${Date.now()}`) as Promise<typeof import("./history.js")>;
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

  it("skips writes when history is disabled", async () => {
    const { appendHistoryRecord } = await loadHistoryModule();
    const record = await appendHistoryRecord(
      {
        action: "summary",
        args: [],
        source: "manual",
        trigger: "cli",
        provider: "ollama",
        model: "mistral",
        latency_ms: 10,
        status: "success",
        copy: false,
        input: "secret",
        output: "output",
      },
      { history_enabled: false }
    );

    expect(record.input).toBe("secret");
    expect(existsSync(historyFile)).toBe(false);
  });

  it("truncates input and output before writing", async () => {
    const { appendHistoryRecord, readHistoryRecords } = await loadHistoryModule();
    await appendHistoryRecord(
      {
        action: "summary",
        args: [],
        source: "manual",
        trigger: "cli",
        provider: "ollama",
        model: "mistral",
        latency_ms: 10,
        status: "success",
        copy: false,
        input: "abcdef",
        output: "uvwxyz",
      },
      { history_truncate_chars: 3 }
    );

    const [record] = await readHistoryRecords();
    expect(record.input).toBe("abc");
    expect(record.output).toBe("uvw");
  });

  it("does not truncate when limit is zero", async () => {
    const { appendHistoryRecord, readHistoryRecords } = await loadHistoryModule();
    await appendHistoryRecord(
      {
        action: "summary",
        args: [],
        source: "manual",
        trigger: "cli",
        provider: "ollama",
        model: "mistral",
        latency_ms: 10,
        status: "success",
        copy: false,
        input: "abcdef",
        output: "uvwxyz",
      },
      { history_truncate_chars: 0 }
    );

    const [record] = await readHistoryRecords();
    expect(record.input).toBe("abcdef");
    expect(record.output).toBe("uvwxyz");
  });

  it("compacts to newest max entries after threshold", async () => {
    const { appendHistoryRecord, readHistoryRecords } = await loadHistoryModule();
    for (let i = 0; i < 4; i += 1) {
      await appendHistoryRecord(
        {
          id: `run-${i}`,
          timestamp: `2026-01-01T00:00:0${i}.000Z`,
          action: `action-${i}`,
          args: [],
          source: "manual",
          trigger: "cli",
          provider: "ollama",
          model: "mistral",
          latency_ms: 10,
          status: "success",
          copy: false,
          input: `input-${i}`,
        },
        { history_max_entries: 3 }
      );
    }

    const records = await readHistoryRecords();
    expect(records.map((record) => record.id)).toEqual(["run-3", "run-2", "run-1"]);
  });

  it("creates the history file with private permissions", async () => {
    const { appendHistoryRecord } = await loadHistoryModule();
    await appendHistoryRecord({
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

    expect(statSync(historyFile).mode & 0o777).toBe(0o600);
  });

  it("clears history", async () => {
    const { appendHistoryRecord, clearHistoryRecords } = await loadHistoryModule();
    await appendHistoryRecord({
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

    await clearHistoryRecords();
    expect(existsSync(historyFile)).toBe(false);
  });

  it("prunes records before an ISO date", async () => {
    const { appendHistoryRecord, pruneHistoryBefore, readHistoryRecords } =
      await loadHistoryModule();
    await appendHistoryRecord({
      id: "old",
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
      input: "old",
    });
    await appendHistoryRecord({
      id: "new",
      timestamp: "2026-02-01T00:00:00.000Z",
      action: "summary",
      args: [],
      source: "manual",
      trigger: "cli",
      provider: "ollama",
      model: "mistral",
      latency_ms: 10,
      status: "success",
      copy: false,
      input: "new",
    });

    const removed = await pruneHistoryBefore(new Date("2026-01-15T00:00:00.000Z"));
    const records = await readHistoryRecords();
    expect(removed).toBe(1);
    expect(records.map((record) => record.id)).toEqual(["new"]);
  });

  it("skips corrupt lines and warns once", async () => {
    const { readHistoryRecords } = await loadHistoryModule();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(
      historyFile,
      [
        JSON.stringify({
          id: "valid-1",
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
          input: "one",
        }),
        "{bad json",
        JSON.stringify({
          id: "valid-2",
          timestamp: "2026-01-02T00:00:00.000Z",
          action: "explain",
          args: [],
          source: "manual",
          trigger: "cli",
          provider: "ollama",
          model: "mistral",
          latency_ms: 20,
          status: "success",
          copy: false,
          input: "two",
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await readHistoryRecords();

    expect(records.map((record) => record.id)).toEqual(["valid-2", "valid-1"]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("skipped 1 corrupt history entry");
  });

  it("does not lose records under concurrent appends with compaction", async () => {
    const { appendHistoryRecord, readHistoryRecords } = await loadHistoryModule();

    const total = 40;
    const maxEntries = 10;
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        appendHistoryRecord(
          {
            id: `r${i}`,
            action: "summary",
            args: [],
            source: "manual",
            trigger: "cli",
            provider: "ollama",
            model: "mistral",
            latency_ms: 1,
            status: "success",
            copy: false,
            input: `in ${i}`,
          },
          { history_max_entries: maxEntries }
        )
      )
    );

    const records = await readHistoryRecords();
    // Compaction keeps the cap; the lock guarantees no torn lines / lost rewrite.
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThanOrEqual(Math.floor(maxEntries * 1.1) + 1);
    // Every surviving record is well-formed (no interleaved/torn writes).
    const ids = new Set(records.map((r) => r.id));
    expect(ids.size).toBe(records.length);
    // The file parses cleanly with no corrupt lines.
    const raw = readFileSync(historyFile, "utf8").split("\n").filter((l) => l.trim().length > 0);
    for (const line of raw) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
