import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ActionContext } from "../lib/types.js";

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: '{"name":"John","age":30}' } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { extract } = await import("./extract.js");

function makeContext(text: string): ActionContext {
  return {
    text,
    contentType: "text",
    config: {
      provider: {
        type: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "mistral",
      },
    },
  };
}

describe("extract action", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it("has correct metadata", () => {
    expect(extract.metadata.id).toBe("extract");
    expect(extract.metadata.name).toBe("Extract Data");
    expect(extract.metadata.triggers).toEqual([]);
  });

  it("returns success with extracted data", async () => {
    const result = await extract.execute(makeContext("name: John, age: 30"));

    expect(result.success).toBe(true);
    expect(result.output).toContain("John");
  });

  it("sends correct messages to OpenAI", async () => {
    await extract.execute(makeContext("email: test@example.com"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("extraction");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("test@example.com");
  });

  it("uses max_tokens of 1024", async () => {
    await extract.execute(makeContext("test"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.max_tokens).toBe(1024);
  });

  it("returns error on API failure", async () => {
    mockCreate.mockImplementationOnce(() => Promise.reject(new Error("rate limit")));

    const result = await extract.execute(makeContext("test"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("rate limit");
  });
});
