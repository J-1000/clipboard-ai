import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createActionRegistry } from "./action-registry.js";
import { runActionCommand, type RunActionDeps } from "./run-action.js";
import type { AIClient, AIConfig, AIResponse } from "./ai.js";
import type {
  ActionRunRecord,
  ActionRunRecordInput,
  HistoryRetentionSettings,
} from "./history.js";
import type { ConfigResponse, ProviderChainResponse } from "./client.js";
import { makeConfig } from "../test-helpers.js";

const mockGetConfig = mock(() => Promise.resolve(makeConfig({ settings: { sensitive_guard: "warn" } })));
const mockGetInput = mock((): Promise<{ text: string }> =>
  Promise.resolve({ text: "clipboard text" })
);
const mockEnforceSafeMode = mock(
  (_config: ConfigResponse, _options?: { yes?: boolean }): Promise<void> => Promise.resolve()
);
const mockCopyToClipboard = mock((_text: string) => undefined);
const mockAppendHistoryRecord = mock(
  (_input: ActionRunRecordInput, _settings?: HistoryRetentionSettings): Promise<ActionRunRecord> =>
    Promise.resolve(undefined as unknown as ActionRunRecord)
);
const mockAIConfigs: AIConfig[] = [];

// Fake AIClient whose generate() streams two tokens and returns their join,
// matching the original mock.module class behavior.
function createAIClient(config: AIConfig): AIClient {
  mockAIConfigs.push(config);
  const client = {
    async generate(): Promise<AIResponse> {
      config.onToken?.("streamed");
      config.onToken?.(" output");
      return { content: "streamed output", model: config.model };
    },
  };
  return client as unknown as AIClient;
}

function deps(): Partial<RunActionDeps> {
  return {
    getConfig: mockGetConfig,
    getInput: mockGetInput,
    enforceSafeMode: mockEnforceSafeMode,
    copyToClipboard: mockCopyToClipboard,
    appendHistoryRecord: mockAppendHistoryRecord,
    createAIClient,
  };
}

describe("runActionCommand history", () => {
  const registry = createActionRegistry([
    {
      id: "summary",
      aliases: ["summarize", "sum"],
      description: "Summary",
      outputTitle: "Summary",
      run: async ({ text }) => `out: ${text}`,
    },
  ]);

  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetConfig.mockImplementation(() =>
      Promise.resolve(makeConfig({ settings: { sensitive_guard: "warn" } }))
    );
    mockGetInput.mockReset();
    mockGetInput.mockImplementation(() => Promise.resolve({ text: "clipboard text" }));
    mockEnforceSafeMode.mockClear();
    mockCopyToClipboard.mockClear();
    mockAppendHistoryRecord.mockClear();
    mockAIConfigs.length = 0;
    spyOn(console, "log").mockImplementation(() => {});
    spyOn(console, "error").mockImplementation(() => {});
    delete process.env.CBAI_SENSITIVE_GUARD_HIT;
    delete process.env.CBAI_MODEL_OVERRIDE;
    delete process.env.CBAI_ENDPOINT_OVERRIDE;
    delete process.env.CBAI_DAEMON_MODE;
    delete process.env.CBAI_SOURCE;
    delete process.env.CBAI_TRIGGER;
    Object.defineProperty(process.stderr, "isTTY", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
  });

  it("records successful runs", async () => {
    await runActionCommand("summary", { registry, deps: deps() });

    expect(mockAppendHistoryRecord).toHaveBeenCalledTimes(1);
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.action).toBe("summary");
    expect(call.source).toBe("manual");
    expect(call.trigger).toBe("cli");
    expect(call.status).toBe("success");
    expect(call.input).toBe("clipboard text");
    expect(call.model).toBe("mistral");
  });

  it("records rerun metadata when provided", async () => {
    await runActionCommand("summary", {
      registry,
      deps: deps(),
      inputText: "stored input",
      source: "rerun",
      trigger: "rerun:abc123",
      replayOf: "abc123",
      args: ["Spanish"],
    });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.source).toBe("rerun");
    expect(call.trigger).toBe("rerun:abc123");
    expect(call.replay_of).toBe("abc123");
    expect(call.args).toEqual(["Spanish"]);
    expect(call.input).toBe("stored input");
  });

  it("blocks sensitive text when guard mode is block", async () => {
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({ settings: { sensitive_guard: "block" } })
    );
    mockGetInput.mockResolvedValueOnce({ text: "api_key = EXAMPLEKEY1234567890" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(runActionCommand("summary", { registry, deps: deps() })).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    expect(mockAppendHistoryRecord).toHaveBeenCalledTimes(1);
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.status).toBe("error");
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("runs sensitive text with force while suppressing history content", async () => {
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({ settings: { sensitive_guard: "block" } })
    );
    mockGetInput.mockResolvedValueOnce({ text: "api_key = EXAMPLEKEY1234567890" });

    await runActionCommand("summary", { registry, deps: deps(), force: true });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.status).toBe("success");
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("warns and suppresses history content in warn mode", async () => {
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({ settings: { sensitive_guard: "warn" } })
    );
    mockGetInput.mockResolvedValueOnce({ text: "card 4111 1111 1111 1111" });

    await runActionCommand("summary", { registry, deps: deps() });

    expect(console.error).toHaveBeenCalledWith(
      "Warning: clipboard looks like it contains a secret."
    );
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("suppresses history content when daemon guard already fired", async () => {
    process.env.CBAI_SENSITIVE_GUARD_HIT = "true";

    await runActionCommand("summary", { registry, deps: deps(), inputText: "plain text" });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.input).toBe("[sensitive content omitted]");
    expect(call.output).toBeUndefined();
  });

  it("uses configured action model and endpoint overrides", async () => {
    let actionConfigModel = "";
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({
        actions: {
          summarize: {
            enabled: true,
            trigger: "length > 200",
            model: "llama3.2:1b",
            endpoint: "http://localhost:11435/v1",
          },
        },
      })
    );
    const overrideRegistry = createActionRegistry([
      {
        id: "summary",
        aliases: ["summarize"],
        description: "Summary",
        outputTitle: "Summary",
        run: async ({ config }) => {
          actionConfigModel = config.provider.model;
          return "ok";
        },
      },
    ]);

    await runActionCommand("summary", { registry: overrideRegistry, deps: deps() });

    expect(mockAIConfigs[0].model).toBe("llama3.2:1b");
    expect(mockAIConfigs[0].endpoint).toBe("http://localhost:11435/v1");
    expect(actionConfigModel).toBe("llama3.2:1b");
    expect(mockEnforceSafeMode.mock.calls[0][0].provider.model).toBe("llama3.2:1b");
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.model).toBe("llama3.2:1b");
  });

  it("prefers daemon environment overrides over action config overrides", async () => {
    process.env.CBAI_MODEL_OVERRIDE = "qwen2.5-coder:14b";
    process.env.CBAI_ENDPOINT_OVERRIDE = "http://localhost:11436/v1";
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({
        actions: {
          summary: {
            enabled: true,
            trigger: "length > 200",
            model: "llama3.2:1b",
            endpoint: "http://localhost:11435/v1",
          },
        },
      })
    );

    await runActionCommand("summary", { registry, deps: deps() });

    expect(mockAIConfigs[0].model).toBe("qwen2.5-coder:14b");
    expect(mockAIConfigs[0].endpoint).toBe("http://localhost:11436/v1");
  });

  it("streams manual TTY output and records accumulated output", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    (console.log as unknown as { mockClear: () => void }).mockClear();
    const streamingRegistry = createActionRegistry([
      {
        id: "summary",
        description: "Summary",
        outputTitle: "Summary",
        run: async ({ ai }) => (await ai.generate("prompt")).content,
      },
    ]);

    await runActionCommand("summary", { registry: streamingRegistry, deps: deps() });

    expect(writeSpy).toHaveBeenCalledWith("streamed");
    expect(writeSpy).toHaveBeenCalledWith(" output");
    expect(writeSpy).toHaveBeenCalledWith("\n");
    expect(console.log).not.toHaveBeenCalledWith("Summary:");
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.output).toBe("streamed output");
    writeSpy.mockRestore();
  });

  it("prints only the result when stdout is not a TTY", async () => {
    (console.log as unknown as { mockClear: () => void }).mockClear();
    (console.error as unknown as { mockClear: () => void }).mockClear();
    const streamingRegistry = createActionRegistry([
      {
        id: "summary",
        description: "Summary",
        progressMessage: "Summarizing clipboard content...",
        outputTitle: "Summary",
        run: async ({ ai }) => (await ai.generate("prompt")).content,
      },
    ]);

    await runActionCommand("summary", { registry: streamingRegistry, deps: deps() });

    expect(mockAIConfigs[0].onToken).toBeUndefined();
    // stdout is what the agent returns to Raycast, the menubar app, and MCP, and
    // what a shell pipeline consumes: it must be the result and nothing else.
    expect((console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls).toEqual([
      ["streamed output"],
    ]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("shows progress on stderr and a header on stdout when attached to a terminal", async () => {
    (console.log as unknown as { mockClear: () => void }).mockClear();
    (console.error as unknown as { mockClear: () => void }).mockClear();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    const copyRegistry = createActionRegistry([
      {
        id: "summary",
        description: "Summary",
        progressMessage: "Summarizing clipboard content...",
        outputTitle: "Summary",
        run: async () => "the result",
      },
    ]);

    // --copy disables streaming, so the buffered terminal layout is used.
    await runActionCommand("summary", { registry: copyRegistry, deps: deps(), copy: true });

    expect(console.error).toHaveBeenCalledWith("Summarizing clipboard content...\n");
    expect(console.log).toHaveBeenCalledWith("Summary:");
    expect(console.log).toHaveBeenCalledWith("the result");
    expect(console.error).toHaveBeenCalledWith("\n(Copied to clipboard)");
    expect(console.log).not.toHaveBeenCalledWith("\n(Copied to clipboard)");
  });

  it("labels runs requested through the agent with the requesting client", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    process.env.CBAI_SOURCE = "menubar";

    await runActionCommand("summary", { registry, deps: deps() });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.source).toBe("menubar");
    expect(call.trigger).toBe("menubar");
  });

  it("labels automatic clipboard triggers as daemon runs", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    process.env.CBAI_TRIGGER = "length > 200";

    await runActionCommand("summary", { registry, deps: deps() });

    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.source).toBe("daemon");
    expect(call.trigger).toBe("length > 200");
  });

  it("ignores an unrecognised CBAI_SOURCE value", async () => {
    process.env.CBAI_DAEMON_MODE = "true";
    process.env.CBAI_SOURCE = "somebody-else";

    await runActionCommand("summary", { registry, deps: deps() });

    expect(mockAppendHistoryRecord.mock.calls[0][0].source).toBe("daemon");
  });

  it("keeps JSON-producing actions buffered on TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    const jsonRegistry = createActionRegistry([
      {
        id: "classify",
        description: "Classify",
        outputTitle: "Classification",
        run: async ({ ai }) => (await ai.generate("prompt")).content,
      },
    ]);

    await runActionCommand("classify", { registry: jsonRegistry, deps: deps() });

    expect(mockAIConfigs[0].onToken).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith("Classification:");
    expect(console.log).toHaveBeenCalledWith("streamed output");
  });

  it("produces real output and history for an image action on a TTY", async () => {
    // Regression: image-only actions don't stream, so enabling streaming on a TTY
    // discarded their result as a blank line and stored "" in history.
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockGetInput.mockReset();
    mockGetInput.mockImplementation(() =>
      Promise.resolve({ text: "", imageBase64: "aW1n", type: "image" } as { text: string })
    );
    const imageRegistry = createActionRegistry([
      {
        id: "caption",
        description: "Caption",
        inputTypes: ["image"],
        outputTitle: "Caption",
        run: async () => "a serene mountain lake",
      },
    ]);

    await runActionCommand("caption", { registry: imageRegistry, deps: deps() });

    // Image actions must not stream (so the result isn't lost) ...
    expect(mockAIConfigs[0].onToken).toBeUndefined();
    // ... and the real result is printed and recorded, not a blank line.
    expect(console.log).toHaveBeenCalledWith("a serene mountain lake");
    const call = mockAppendHistoryRecord.mock.calls[0][0];
    expect(call.status).toBe("success");
    expect(call.output).toBe("a serene mountain lake");
  });

  it("selects a named profile credential and falls back in order", async () => {
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({
        actions: {
          summary: {
            enabled: true,
            trigger: "",
            provider_profile: "cloud",
          },
        },
      })
    );
    const chain: ProviderChainResponse = {
      profiles: [
        {
          name: "cloud",
          type: "openai",
          endpoint: "https://api.openai.com/v1",
          model: "gpt-5-mini",
          api_key: "cloud-secret",
        },
        {
          name: "local",
          type: "ollama",
          endpoint: "http://localhost:11434/v1",
          model: "mistral",
        },
      ],
      max_tokens: 2048,
    };
    const getProviderChain = mock(() => Promise.resolve(chain));
    const created: AIConfig[] = [];
    const fallbackRegistry = createActionRegistry([
      {
        id: "summary",
        description: "Summary",
        outputTitle: "Summary",
        run: async ({ ai }) => (await ai.generate("prompt")).content,
      },
    ]);

    await runActionCommand("summary", {
      registry: fallbackRegistry,
      deps: {
        ...deps(),
        getProviderChain,
        createAIClient: (config) => {
          created.push(config);
          return {
            generate: async () => {
              if (config.model === "gpt-5-mini") {
                throw new Error("503 service unavailable");
              }
              return { content: "local result", model: config.model };
            },
          } as unknown as AIClient;
        },
      },
    });

    expect(getProviderChain).toHaveBeenCalledWith("summary");
    expect(created.map((config) => config.apiKey)).toEqual(["cloud-secret", undefined]);
    expect(console.error).toHaveBeenCalledWith(
      'Warning: provider profile "cloud" failed; trying fallback.'
    );
    const history = mockAppendHistoryRecord.mock.calls[0][0];
    expect(history.provider_profile).toBe("local");
    expect(history.provider).toBe("ollama");
    expect(history.model).toBe("mistral");
    expect(history.output).toBe("local result");
  });

  it("skips a profile at its daily limit and records fallback usage", async () => {
    mockGetConfig.mockResolvedValueOnce(
      makeConfig({
        actions: {
          summary: { enabled: true, trigger: "", provider_profile: "cloud" },
        },
      })
    );
    const getProviderChain = mock((): Promise<ProviderChainResponse> =>
      Promise.resolve({
        profiles: [
          {
            name: "cloud",
            type: "openai",
            endpoint: "https://api.openai.com/v1",
            model: "gpt-5-mini",
            daily_token_limit: 100,
          },
          {
            name: "local",
            type: "ollama",
            endpoint: "http://localhost:11434/v1",
            model: "mistral",
          },
        ],
        max_tokens: 1024,
      })
    );
    const getDailyProviderUsage = mock(() =>
      Promise.resolve({ profileTokens: 100, actionTokens: 50 })
    );
    const appendProviderUsage = mock(() => Promise.resolve());
    const limitedRegistry = createActionRegistry([
      {
        id: "summary",
        description: "Summary",
        outputTitle: "Summary",
        run: async ({ ai }) => (await ai.generate("prompt")).content,
      },
    ]);

    await runActionCommand("summary", {
      registry: limitedRegistry,
      deps: {
        ...deps(),
        getProviderChain,
        getDailyProviderUsage,
        appendProviderUsage,
        createAIClient: (config) =>
          ({
            generate: async () => ({ content: "within budget", model: config.model }),
            getUsage: () => ({ promptTokens: 12, completionTokens: 3 }),
          }) as unknown as AIClient,
      },
    });

    expect(getDailyProviderUsage).toHaveBeenCalledWith("cloud", "summary");
    expect(appendProviderUsage).toHaveBeenCalledWith({
      action: "summary",
      profile: "local",
      prompt_tokens: 12,
      completion_tokens: 3,
    });
    const history = mockAppendHistoryRecord.mock.calls[0][0];
    expect(history.provider_profile).toBe("local");
    expect(history.prompt_tokens).toBe(12);
    expect(history.completion_tokens).toBe(3);
  });
});
