import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ActionContext } from "../lib/types.js";

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: '{"category":"code","confidence":0.95,"reasoning":"Contains function"}' } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { classify } = await import("./classify.js");

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

describe("classify action", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it("has correct metadata", () => {
    expect(classify.metadata.id).toBe("classify");
    expect(classify.metadata.name).toBe("Classify");
    expect(classify.metadata.description).toContain("Categorize");
  });

  it("returns success with classification output", async () => {
    const result = await classify.execute(makeContext("func main() {}"));

    expect(result.success).toBe(true);
    expect(result.output).toContain("code");
    expect(result.output).toContain("confidence");
  });

  it("sends correct messages to OpenAI", async () => {
    await classify.execute(makeContext("some text"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("classifier");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("some text");
  });

  it("uses max_tokens of 256", async () => {
    await classify.execute(makeContext("test"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.max_tokens).toBe(256);
  });

  it("returns error on API failure", async () => {
    mockCreate.mockImplementationOnce(() => Promise.reject(new Error("API error")));

    const result = await classify.execute(makeContext("test"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("API error");
  });

  it("handles empty choices response", async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.resolve({ choices: [{ message: { content: null } }] })
    );

    const result = await classify.execute(makeContext("test"));
    expect(result.success).toBe(true);
    expect(result.output).toBe("");
  });
});
