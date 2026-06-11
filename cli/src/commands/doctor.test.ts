import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const testRoot = mkdtempSync(join(tmpdir(), "cbai-doctor-test-"));
const pluginDir = join(testRoot, "actions");
const historyFile = join(testRoot, "history.jsonl");

const mockGetStatus = mock(() =>
  Promise.resolve({
    status: "running",
    uptime: "1s",
    version: "0.1.0",
    clipboard: { text: "", type: "text", timestamp: "" },
  })
);

const mockGetConfig = mock(() =>
  Promise.resolve({
    provider: {
      type: "ollama",
      endpoint: "http://ollama.local/v1",
      model: "mistral",
    },
    actions: {
      caption: { enabled: true, trigger: "mime:image" },
    },
    settings: {
      poll_interval: 150,
      safe_mode: false,
      notifications: false,
      log_level: "info",
    },
  })
);

mock.module("../lib/client.js", () => ({
  getStatus: mockGetStatus,
  getConfig: mockGetConfig,
}));
mock.module("../lib/plugin-actions.js", () => ({
  DEFAULT_PLUGIN_DIR: pluginDir,
}));

const { doctorCommand } = await import("./doctor.js");

describe("doctorCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
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

  it("prints diagnostic pass/fail/info lines", async () => {
    await doctorCommand();

    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("PASS daemon socket reachable");
    expect(output).toContain("PASS daemon version matches CLI (0.1.0)");
    expect(output).toContain("PASS provider endpoint reachable");
    expect(output).toContain("PASS configured model available (mistral)");
    expect(output).toContain("INFO vision capability: unknown");
    expect(output).toContain("PASS history file size");
    expect(output).toContain("PASS plugin directory scan (1 file)");
  });
});
