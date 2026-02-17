import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ActionContext } from "../lib/types.js";

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: "hola mundo" } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { translate } = await import("./translate.js");

function makeContext(text: string, targetLang?: string): ActionContext & { targetLang?: string } {
  return {
    text,
    contentType: "text",
    targetLang,
    config: {
      provider: {
        type: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "mistral",
      },
    },
  };
}

describe("translate action", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it("has correct metadata", () => {
    expect(translate.metadata.id).toBe("translate");
    expect(translate.metadata.name).toBe("Translate");
    expect(translate.metadata.triggers).toEqual([]);
  });

  it("returns success with translation", async () => {
    const result = await translate.execute(makeContext("hello world", "Spanish"));

    expect(result.success).toBe(true);
    expect(result.output).toBe("hola mundo");
  });

  it("sends target language in system prompt", async () => {
    await translate.execute(makeContext("hello", "French"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("French");
  });

  it("defaults to English when no target language", async () => {
    await translate.execute(makeContext("bonjour"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain("English");
  });

  it("sends text directly as user message", async () => {
    await translate.execute(makeContext("test input", "German"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("test input");
  });

  it("uses max_tokens of 1024", async () => {
    await translate.execute(makeContext("test", "Spanish"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.max_tokens).toBe(1024);
  });

  it("returns error on API failure", async () => {
    mockCreate.mockImplementationOnce(() => Promise.reject(new Error("network error")));

    const result = await translate.execute(makeContext("test", "Spanish"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("network error");
  });
});
