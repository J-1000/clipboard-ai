import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ActionContext } from "../lib/types.js";

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: "A brief summary of the text." } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { summarize } = await import("./summarize.js");

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

describe("summarize action", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it("has correct metadata", () => {
    expect(summarize.metadata.id).toBe("summarize");
    expect(summarize.metadata.name).toBe("Summarize");
    expect(summarize.metadata.triggers).toEqual(["length > 200"]);
  });

  it("returns success with summary", async () => {
    const result = await summarize.execute(makeContext("A very long article..."));

    expect(result.success).toBe(true);
    expect(result.output).toBe("A brief summary of the text.");
  });

  it("sends correct messages to OpenAI", async () => {
    await summarize.execute(makeContext("Long content here"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("summaries");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Long content here");
  });

  it("uses max_tokens of 512", async () => {
    await summarize.execute(makeContext("test"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.max_tokens).toBe(512);
  });

  it("returns error on API failure", async () => {
    mockCreate.mockImplementationOnce(() => Promise.reject(new Error("server error")));

    const result = await summarize.execute(makeContext("test"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("server error");
  });
});
