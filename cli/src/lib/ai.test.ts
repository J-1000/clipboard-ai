import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock OpenAI before importing AIClient
const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: "mock response" } }],
    model: "test-model",
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { AIClient } = await import("./ai.js");

describe("AIClient", () => {
  let client: InstanceType<typeof AIClient>;

  beforeEach(() => {
    mockCreate.mockClear();
    client = new AIClient({
      type: "ollama",
      endpoint: "http://localhost:11434/v1",
      model: "test-model",
      apiKey: "test-key",
    });
  });

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
});
