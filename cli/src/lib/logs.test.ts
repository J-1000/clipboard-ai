import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;
let logDir: string;

async function loadLogsModule() {
  return import(`./logs.js?test=${Date.now()}`);
}

describe("logs library", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "cbai-logs-test-"));
    logDir = join(testHome, ".clipboard-ai");
    process.env.CBAI_LOG_DIR = logDir;
  });

  it("returns the last N lines", async () => {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "agent.log"), "l1\nl2\nl3\n", "utf8");

    const { readAgentLogs } = await loadLogsModule();
    const lines = await readAgentLogs({ tail: 2 });
    expect(lines).toEqual(["l2", "l3"]);
  });

  it("supports error log file", async () => {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "agent.err"), "e1\ne2\n", "utf8");

    const { readAgentLogs } = await loadLogsModule();
    const lines = await readAgentLogs({ tail: 10, file: "err" });
    expect(lines).toEqual(["e1", "e2"]);
  });

  it("validates tail argument", async () => {
    const { readAgentLogs } = await loadLogsModule();
    await expect(readAgentLogs({ tail: 0 })).rejects.toThrow(
      "tail must be a positive integer"
    );
  });
});
