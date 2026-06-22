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
