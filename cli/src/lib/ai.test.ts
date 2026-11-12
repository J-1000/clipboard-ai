import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

const mockConstructedOptions: Array<Record<string, unknown>> = [];

// Mock OpenAI before importing AIClient. The param/return types are
// deliberately loose: the real OpenAI types are large, and tests only need a
// typed first argument (so `.mock.calls[n][0]` is a proper tuple) plus the
// freedom to resolve assorted shapes via `mockResolvedValueOnce`.
const mockCreate = mock(
  (_params: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve({
      choices: [{ message: { content: "mock response" } }],
      model: "test-model",
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    })
);

async function* streamChunks(tokens: string[]) {
  for (const token of tokens) {
    yield {
      choices: [{ delta: { content: token } }],
      model: "stream-model",
    };
  }
}

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    constructor(public opts: Record<string, unknown>) {
      mockConstructedOptions.push(opts);
    }
  },
}));

const { AIClient } = await import("./ai.js");

describe("AIClient", () => {
  let client: InstanceType<typeof AIClient>;

  beforeEach(() => {
    mockCreate.mockClear();
    mockConstructedOptions.length = 0;
    client = new AIClient({
      type: "ollama",
      endpoint: "http://localhost:11434/v1",
      model: "test-model",
      apiKey: "test-key",
    });
  });

  afterEach(() => mock.restore());

  describe("getBaseURL resolution", () => {
    it("uses endpoint when provided", () => {
      const c = new AIClient({
        type: "ollama",
        endpoint: "http://custom:8080/v1",
        model: "m",
      });
      // Verify by making a call — the constructor passes baseURL to OpenAI
      expect(c).toBeDefined();
    });

    it("defaults to ollama for unknown type", () => {
      const c = new AIClient({ type: "unknown", endpoint: "", model: "m" });
      expect(c).toBeDefined();
    });

    it("defaults anthropic to the OpenAI-compatible endpoint", () => {
      const c = new AIClient({
        type: "anthropic",
        endpoint: "",
        model: "claude-haiku-4-5-20251001",
        apiKey: "anthropic-key",
      });
      expect(c).toBeDefined();
      expect(mockConstructedOptions.at(-1)).toEqual({
        baseURL: "https://api.anthropic.com/v1/",
        apiKey: "anthropic-key",
      });
    });
  });

  describe("summarize", () => {
    it("sends correct prompts", async () => {
      const result = await client.summarize("test text");
      expect(result).toBe("mock response");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("summaries");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("test text");
    });
  });

  describe("explain", () => {
    it("sends correct prompts", async () => {
      const result = await client.explain("some code");
      expect(result).toBe("mock response");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("explain");
      expect(messages[1].content).toContain("some code");
    });
  });

  describe("translate", () => {
    it("sends correct prompts with target language", async () => {
      const result = await client.translate("hello", "Spanish");
      expect(result).toBe("mock response");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("translator");
      expect(messages[1].content).toContain("Spanish");
      expect(messages[1].content).toContain("hello");
    });
  });

  describe("improve", () => {
    it("sends correct prompts", async () => {
      const result = await client.improve("rough draft");
      expect(result).toBe("mock response");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("editor");
      expect(messages[1].content).toContain("rough draft");
    });
  });

  describe("extractData", () => {
    it("sends correct prompts and requests JSON output", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"name":"John","age":30}' } }],
        model: "test-model",
      });
      const result = await client.extractData("name: John, age: 30");
      expect(JSON.parse(result)).toEqual({ name: "John", age: 30 });

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.response_format).toEqual({ type: "json_object" });
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("extraction");
      expect(messages[1].content).toContain("name: John, age: 30");
    });

    it("throws a clear error when the model returns non-JSON", async () => {
      // Both the JSON attempt and the plain fallback return non-JSON.
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "not json" } }],
        model: "test-model",
      });
      await expect(client.extractData("x")).rejects.toThrow(/did not return valid JSON/);
    });
  });

  describe("classify", () => {
    it("sends correct prompts and validates the category", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"category":"code","confidence":0.9,"reasoning":"has func"}' } }],
        model: "test-model",
      });
      const result = await client.classify("func main() {}");
      expect(JSON.parse(result).category).toBe("code");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.response_format).toEqual({ type: "json_object" });
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("classifier");
      expect(messages[1].content).toContain("func main() {}");
    });

    it("throws when the classifier response lacks a category", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"confidence":0.5}' } }],
        model: "test-model",
      });
      await expect(client.classify("x")).rejects.toThrow(/missing a 'category'/);
    });
  });

  describe("empty choices", () => {
    it("throws a descriptive error for text generation", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [],
        model: "test-model",
      });

      await expect(client.generate("hello")).rejects.toThrow(
        "provider returned no completion choices"
      );
    });

    it("throws a descriptive error for image generation", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [],
        model: "test-model",
      });

      await expect(client.generateWithImage("describe", "aW1hZ2U=")).rejects.toThrow(
        "provider returned no completion choices"
      );
    });
  });

  describe("generateStream", () => {
    it("accumulates streamed tokens and invokes callback", async () => {
      mockCreate.mockResolvedValueOnce(streamChunks(["hello", " ", "world"]));
      const chunks: string[] = [];

      const result = await client.generateStream("test", undefined, (token) => {
        chunks.push(token);
      });

      expect(result.content).toBe("hello world");
      expect(result.model).toBe("stream-model");
      expect(chunks).toEqual(["hello", " ", "world"]);

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.stream).toBe(true);
    });

    it("throws when the stream yields no content tokens", async () => {
      mockCreate.mockResolvedValueOnce(streamChunks([]));
      await expect(client.generateStream("test", undefined, () => {})).rejects.toThrow(
        /no completion choices/
      );
    });
  });

  describe("token usage", () => {
    it("counts tokens used by JSON actions", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"category":"code","confidence":0.9,"reasoning":"r"}' } }],
        model: "test-model",
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      });

      await client.classify("func main() {}");

      expect(client.getUsage()).toEqual({ promptTokens: 11, completionTokens: 7 });
    });

    it("counts tokens reported at the end of a stream", async () => {
      async function* withUsage() {
        yield { choices: [{ delta: { content: "hi" } }], model: "stream-model" };
        yield { choices: [], model: "stream-model", usage: { prompt_tokens: 4, completion_tokens: 2 } };
      }
      mockCreate.mockResolvedValueOnce(withUsage());

      const result = await client.generateStream("test", undefined, () => {});

      expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 2 });
      expect(client.getUsage()).toEqual({ promptTokens: 4, completionTokens: 2 });
      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.stream_options).toEqual({ include_usage: true });
    });
  });

  describe("generateJSON fallback", () => {
    it("retries as a plain completion when the provider rejects response_format", async () => {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error("unsupported"), { status: 400 }));
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"a":1}' } }],
        model: "test-model",
      });

      expect(await client.extractData("x")).toBe('{"a":1}');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      const retry = mockCreate.mock.calls[1][0] as Record<string, unknown>;
      expect(retry.response_format).toBeUndefined();
    });

    it("does not retry authentication or network failures", async () => {
      mockCreate.mockRejectedValueOnce(Object.assign(new Error("bad key"), { status: 401 }));
      await expect(client.extractData("x")).rejects.toThrow("bad key");
      expect(mockCreate).toHaveBeenCalledTimes(1);

      mockCreate.mockClear();
      mockCreate.mockRejectedValueOnce(new Error("Connection error."));
      await expect(client.extractData("x")).rejects.toThrow("Connection error.");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

  });

  describe("fenced JSON", () => {
    it("accepts JSON wrapped in a Markdown code fence", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '```json\n{"name":"John"}\n```' } }],
        model: "test-model",
      });

      expect(await client.extractData("x")).toBe('{"name":"John"}');
    });

    it("accepts a bare fence and surrounding whitespace", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '\n```\n{"category":"code","confidence":1,"reasoning":"r"}\n```\n' } }],
        model: "test-model",
      });

      expect(JSON.parse(await client.classify("x")).category).toBe("code");
    });
  });

  describe("provider-specific parameters", () => {
    it("sends max_completion_tokens and no temperature to OpenAI", async () => {
      const openai = new AIClient({
        type: "openai",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-5-mini",
        apiKey: "sk-test",
        maxTokens: 2048,
      });

      await openai.generate("test");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.max_completion_tokens).toBe(2048);
      expect("max_tokens" in call).toBe(false);
      expect("temperature" in call).toBe(false);
    });

    it("keeps max_tokens and temperature for other OpenAI-compatible providers", async () => {
      for (const type of ["ollama", "anthropic", "custom"]) {
        mockCreate.mockClear();
        const other = new AIClient({ type, endpoint: "http://localhost:1/v1", model: "m" });

        await other.generate("test");

        const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
        expect(call.max_tokens).toBe(1024);
        expect(call.temperature).toBe(0.7);
        expect("max_completion_tokens" in call).toBe(false);
      }
    });
  });

  describe("max_tokens", () => {
    it("defaults to 1024 when unset", async () => {
      await client.generate("test");
      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.max_tokens).toBe(1024);
    });

    it("honors a configured maxTokens", async () => {
      const c = new AIClient({
        type: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "test-model",
        maxTokens: 4096,
      });
      await c.generate("test");
      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.max_tokens).toBe(4096);
    });

    it("ignores a non-positive maxTokens and falls back to the default", async () => {
      const c = new AIClient({
        type: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "test-model",
        maxTokens: 0,
      });
      await c.generate("test");
      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(call.max_tokens).toBe(1024);
    });
  });

  describe("truncation warning", () => {
    it("warns on stderr when the completion is cut at the token limit", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "partial" }, finish_reason: "length" }],
        model: "test-model",
      });
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        await client.generate("test");
        const logged = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(logged).toContain("truncated");
        expect(logged).toContain("max_tokens");
      } finally {
        errSpy.mockRestore();
      }
    });

    it("does not warn on a normal stop", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        await client.generate("test");
        expect(errSpy).not.toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });
  });
});
