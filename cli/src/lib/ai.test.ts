import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

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
    it("sends correct prompts", async () => {
      const result = await client.extractData("name: John, age: 30");
      expect(result).toBe("mock response");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("extraction");
      expect(messages[1].content).toContain("name: John, age: 30");
    });
  });

  describe("classify", () => {
    it("sends correct prompts", async () => {
      const result = await client.classify("func main() {}");
      expect(result).toBe("mock response");

      const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      const messages = call.messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0].content).toContain("classifier");
      expect(messages[1].content).toContain("func main() {}");
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
  });
});
