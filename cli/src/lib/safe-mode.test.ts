import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { isCloudProvider, enforceSafeMode } from "./safe-mode.js";
import type { ConfigResponse } from "./client.js";

function makeConfig(overrides: {
  type?: string;
  endpoint?: string;
  safe_mode?: boolean;
}): ConfigResponse {
  const type = overrides.type ?? "ollama";
  const endpoint =
    overrides.endpoint ?? (type === "ollama" ? "http://localhost:11434/v1" : "");
  return {
    provider: {
      type,
      endpoint,
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

  it("returns true for ollama with a remote endpoint override", () => {
    expect(isCloudProvider("ollama", "https://api.example.com/v1")).toBe(true);
  });

  it("returns false for openai with a localhost endpoint override", () => {
    expect(isCloudProvider("openai", "http://localhost:8080/v1")).toBe(false);
  });

  it("returns false for custom localhost endpoint", () => {
    expect(isCloudProvider("custom", "http://localhost:8080/v1")).toBe(false);
  });

  it("returns false for custom 127.0.0.1 endpoint", () => {
    expect(isCloudProvider("custom", "http://127.0.0.1:8080/v1")).toBe(false);
  });

  it("returns false for an IPv6 loopback endpoint", () => {
    expect(isCloudProvider("ollama", "http://[::1]:11434/v1")).toBe(false);
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
  const origSource = process.env.CBAI_SOURCE;
  const origStdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CBAI_DAEMON_MODE;
    } else {
      process.env.CBAI_DAEMON_MODE = origEnv;
    }
    if (origSource === undefined) {
      delete process.env.CBAI_SOURCE;
    } else {
      process.env.CBAI_SOURCE = origSource;
    }
    if (origStdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", origStdinTTY);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });

  it("explains an automatic trigger block as daemon auto-triggered", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    delete process.env.CBAI_SOURCE;
    const config = makeConfig({ type: "openai", safe_mode: true });
    await expect(enforceSafeMode(config)).rejects.toThrow(
      "safe mode: blocked cloud call to openai (daemon auto-triggered)"
    );
  });

  it("names the requesting client when a manual run through the agent is blocked", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    process.env.CBAI_SOURCE = "menubar";
    const config = makeConfig({ type: "openai", safe_mode: true });
    await expect(enforceSafeMode(config)).rejects.toThrow(
      "safe mode: blocked cloud call to openai (requested via menubar; set safe_mode = false or route this action to a local provider)"
    );
  });

  it("fails with a clear message instead of prompting when stdin is not a terminal", async () => {
    delete process.env.CBAI_DAEMON_MODE;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const config = makeConfig({ type: "openai", safe_mode: true });
    await expect(enforceSafeMode(config)).rejects.toThrow("stdin is not a terminal");
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

  it("allows anthropic with --yes flag", async () => {
    const config = makeConfig({ type: "anthropic", safe_mode: true });
    await expect(enforceSafeMode(config, { yes: true })).resolves.toBeUndefined();
  });
});
