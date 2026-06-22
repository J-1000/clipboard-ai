import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createActionRegistry } from "./action-registry.js";
import { runActionCommand, type RunActionDeps } from "./run-action.js";
import type { AIClient, AIConfig, AIResponse } from "./ai.js";
import type {
  ActionRunRecord,
  ActionRunRecordInput,
  HistoryRetentionSettings,
} from "./history.js";
import type { ConfigResponse } from "./client.js";
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

  it("uses buffered output when stdout is not a TTY", async () => {
    const streamingRegistry = createActionRegistry([
      {
        id: "summary",
        description: "Summary",
        outputTitle: "Summary",
        run: async ({ ai }) => (await ai.generate("prompt")).content,
      },
    ]);

    await runActionCommand("summary", { registry: streamingRegistry, deps: deps() });

    expect(mockAIConfigs[0].onToken).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith("Summary:");
    expect(console.log).toHaveBeenCalledWith("streamed output");
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
});
