import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { isCloudProvider, enforceSafeMode } from "./safe-mode.js";
import type { ConfigResponse } from "./client.js";

function makeConfig(overrides: {
  type?: string;
  endpoint?: string;
  safe_mode?: boolean;
}): ConfigResponse {
  return {
    provider: {
      type: overrides.type ?? "ollama",
      endpoint: overrides.endpoint ?? "http://localhost:11434/v1",
      model: "test-model",
    },
    actions: {},
    settings: {
      poll_interval: 500,
      safe_mode: overrides.safe_mode ?? true,
      notifications: false,
      log_level: "info",
    },
  };
}

describe("isCloudProvider", () => {
  it("returns true for openai", () => {
    expect(isCloudProvider("openai")).toBe(true);
  });

  it("returns true for anthropic", () => {
    expect(isCloudProvider("anthropic")).toBe(true);
  });

  it("returns false for ollama", () => {
    expect(isCloudProvider("ollama")).toBe(false);
  });

  it("returns false for custom localhost endpoint", () => {
    expect(isCloudProvider("custom", "http://localhost:8080/v1")).toBe(false);
  });

  it("returns false for custom 127.0.0.1 endpoint", () => {
    expect(isCloudProvider("custom", "http://127.0.0.1:8080/v1")).toBe(false);
  });

  it("returns true for custom remote endpoint", () => {
    expect(isCloudProvider("custom", "https://api.example.com/v1")).toBe(true);
  });

  it("returns true for unknown type with no endpoint", () => {
    expect(isCloudProvider("unknown")).toBe(true);
  });
});

describe("enforceSafeMode", () => {
  const origEnv = process.env.CBAI_DAEMON_MODE;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CBAI_DAEMON_MODE;
    } else {
      process.env.CBAI_DAEMON_MODE = origEnv;
    }
  });

  it("allows ollama regardless of safe mode", async () => {
    const config = makeConfig({ type: "ollama", safe_mode: true });
    await expect(enforceSafeMode(config)).resolves.toBeUndefined();
  });

  it("allows custom localhost regardless of safe mode", async () => {
    const config = makeConfig({
      type: "custom",
      endpoint: "http://localhost:8080/v1",
      safe_mode: true,
    });
    await expect(enforceSafeMode(config)).resolves.toBeUndefined();
  });

  it("allows cloud provider when safe mode is off", async () => {
    const config = makeConfig({ type: "openai", safe_mode: false });
    await expect(enforceSafeMode(config)).resolves.toBeUndefined();
  });

  it("blocks openai in daemon mode", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    const config = makeConfig({ type: "openai", safe_mode: true });
    await expect(enforceSafeMode(config)).rejects.toThrow("safe mode");
  });

  it("blocks anthropic in daemon mode", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    const config = makeConfig({ type: "anthropic", safe_mode: true });
    await expect(enforceSafeMode(config)).rejects.toThrow("safe mode");
  });

  it("blocks custom remote endpoint in daemon mode", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    const config = makeConfig({
      type: "custom",
      endpoint: "https://api.example.com/v1",
      safe_mode: true,
    });
    await expect(enforceSafeMode(config)).rejects.toThrow("safe mode");
  });

  it("allows cloud provider with --yes flag", async () => {
    const config = makeConfig({ type: "openai", safe_mode: true });
    await expect(enforceSafeMode(config, { yes: true })).resolves.toBeUndefined();
  });
});
