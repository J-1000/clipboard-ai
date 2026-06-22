import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { configCommand } from "./config.js";
import { makeConfig } from "../test-helpers.js";

const mockGetConfig = mock(() =>
  Promise.resolve(
    makeConfig({
      provider: {
        type: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "mistral",
        api_key: "<redacted>",
      },
      actions: {
        summarize: { enabled: true, trigger: "length > 200" },
        explain: { enabled: false, trigger: "mime:code" },
      },
      settings: {
        poll_interval: 150,
        safe_mode: true,
        notifications: true,
        log_level: "info",
        http_enabled: true,
        http_addr: "127.0.0.1:9159",
        http_auth_token: "secret-token",
      },
    })
  )
);

describe("configCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetConfig.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => mock.restore());

  function output(): string {
    return logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
  }

  it("fetches config from agent", async () => {
    await configCommand({ getConfig: mockGetConfig });
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it("displays provider info", async () => {
    await configCommand({ getConfig: mockGetConfig });
    expect(output()).toContain("Type:     ollama");
    expect(output()).toContain("Model:    mistral");
    expect(output()).toContain("Endpoint: http://localhost:11434/v1");
    expect(output()).toContain("API key:  [set]");
  });

  it("displays settings", async () => {
    await configCommand({ getConfig: mockGetConfig });
    expect(output()).toContain("Poll interval:  150ms");
    expect(output()).toContain("Safe mode:      true");
    expect(output()).toContain("Notifications:  true");
    expect(output()).toContain("Log level:      info");
    expect(output()).toContain("HTTP enabled:   true");
    expect(output()).toContain("HTTP address:   127.0.0.1:9159");
    expect(output()).toContain("HTTP token:     [set]");
  });

  it("does not display secret values", async () => {
    await configCommand({ getConfig: mockGetConfig });
    expect(output()).not.toContain("<redacted>");
    expect(output()).not.toContain("secret-token");
  });

  it("displays actions with enabled/disabled status", async () => {
    await configCommand({ getConfig: mockGetConfig });
    expect(output()).toContain("summarize: length > 200");
    expect(output()).toContain("explain: mime:code");
  });
});
