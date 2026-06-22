import { beforeEach, describe, expect, it, mock, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { doctorCommand } from "./doctor.js";
import { makeConfig } from "../test-helpers.js";
import type { StatusResponse } from "../lib/client.js";

const testRoot = mkdtempSync(join(tmpdir(), "cbai-doctor-test-"));
const pluginDir = join(testRoot, "actions");
const historyFile = join(testRoot, "history.jsonl");

const mockGetStatus = mock(
  (): Promise<StatusResponse> =>
    Promise.resolve({
      status: "running",
      uptime: "1s",
      version: "0.1.0",
      clipboard: { text: "", type: "text", timestamp: "" },
    })
);

const mockGetConfig = mock(() =>
  Promise.resolve(
    makeConfig({
      provider: {
        type: "ollama",
        endpoint: "http://ollama.local/v1",
        model: "mistral",
      },
      actions: {
        caption: { enabled: true, trigger: "mime:image" },
      },
    })
  )
);

describe("doctorCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Disable ANSI color so assertions match plain "PASS"/"FAIL" labels
    // regardless of whether the test runner's stdout is a TTY.
    process.env.NO_COLOR = "1";
    mockGetStatus.mockClear();
    mockGetConfig.mockClear();
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "plugin.mjs"), "export default {}");
    writeFileSync(historyFile, "{}\n");
    process.env.CBAI_HISTORY_FILE = historyFile;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [{ name: "mistral" }] }), {
          headers: { "content-type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    delete process.env.NO_COLOR;
  });

  it("prints diagnostic pass/fail/info lines", async () => {
    await doctorCommand({ getStatus: mockGetStatus, getConfig: mockGetConfig, pluginDir });

    const output = logSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
    expect(output).toContain("PASS daemon socket reachable");
    expect(output).toContain("PASS daemon version matches CLI (0.1.0)");
    expect(output).toContain("PASS provider endpoint reachable");
    expect(output).toContain("PASS configured model available (mistral)");
    expect(output).toContain("INFO vision capability: unknown");
    expect(output).toContain("PASS history file size");
    expect(output).toContain("PASS plugin directory scan (1 file)");
  });

  it("prints a summary and exits 0 when all checks pass", async () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    try {
      await doctorCommand({ getStatus: mockGetStatus, getConfig: mockGetConfig, pluginDir });
      const output = logSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
      expect(output).toMatch(/\d+ passed, 0 failed/);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = prev;
    }
  });

  it("sets a non-zero exit code when a check fails", async () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    try {
      const failingStatus = mock(() => Promise.reject(new Error("socket missing")));
      await doctorCommand({
        getStatus: failingStatus as unknown as typeof mockGetStatus,
        getConfig: mockGetConfig,
        pluginDir,
      });
      const output = logSpy.mock.calls.map((call: unknown[]) => call[0]).join("\n");
      expect(output).toContain("FAIL daemon socket reachable");
      expect(output).toMatch(/passed, [1-9]\d* failed/);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prev;
    }
  });
});
