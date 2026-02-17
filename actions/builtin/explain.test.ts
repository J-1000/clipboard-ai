import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { ActionContext } from "../lib/types.js";

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: "This is a Go main function entry point." } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { explain } = await import("./explain.js");

function makeContext(text: string): ActionContext {
  return {
    text,
    contentType: "code",
    config: {
      provider: {
        type: "ollama",
        endpoint: "http://localhost:11434/v1",
        model: "mistral",
      },
    },
  };
}

describe("explain action", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it("has correct metadata", () => {
    expect(explain.metadata.id).toBe("explain");
    expect(explain.metadata.name).toBe("Explain");
    expect(explain.metadata.triggers).toEqual(["mime:code"]);
  });

  it("returns success with explanation", async () => {
    const result = await explain.execute(makeContext("func main() {}"));

    expect(result.success).toBe(true);
    expect(result.output).toContain("Go main function");
  });

  it("sends correct messages to OpenAI", async () => {
    await explain.execute(makeContext("const x = 1"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("explain");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("const x = 1");
  });

  it("uses max_tokens of 1024", async () => {
    await explain.execute(makeContext("test"));

    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.max_tokens).toBe(1024);
  });

  it("returns error on API failure", async () => {
    mockCreate.mockImplementationOnce(() => Promise.reject(new Error("timeout")));

    const result = await explain.execute(makeContext("test"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
