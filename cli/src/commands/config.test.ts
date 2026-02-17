import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

const mockGetConfig = mock(() =>
  Promise.resolve({
    provider: { type: "ollama", endpoint: "http://localhost:11434/v1", model: "mistral" },
    actions: {
      summarize: { enabled: true, trigger: "length > 200" },
      explain: { enabled: false, trigger: "mime:code" },
    },
    settings: { poll_interval: 150, safe_mode: true, notifications: true, log_level: "info" },
  })
);

mock.module("../lib/client.js", () => ({
  getConfig: mockGetConfig,
}));

const { configCommand } = await import("./config.js");

describe("configCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetConfig.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  it("fetches config from agent", async () => {
    await configCommand();
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("displays provider info", async () => {
    await configCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Type:     ollama");
    expect(output).toContain("Model:    mistral");
    expect(output).toContain("Endpoint: http://localhost:11434/v1");
  });

  it("displays settings", async () => {
    await configCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Poll interval:  150ms");
    expect(output).toContain("Safe mode:      true");
    expect(output).toContain("Notifications:  true");
    expect(output).toContain("Log level:      info");
  });

  it("displays actions with enabled/disabled status", async () => {
    await configCommand();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("summarize: length > 200");
    expect(output).toContain("explain: mime:code");
  });
});
