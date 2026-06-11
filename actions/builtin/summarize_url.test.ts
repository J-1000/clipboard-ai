import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import type { ActionContext } from "../lib/types.js";

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: "URL summary" } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { summarizeUrl, htmlToText, parseSingleURL, fetchURLText } = await import(
  "./summarize_url.js"
);

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

describe("summarize_url action", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCreate.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has correct metadata", () => {
    expect(summarizeUrl.metadata.id).toBe("summarize_url");
    expect(summarizeUrl.metadata.name).toBe("Summarize URL");
  });

  it("requires a single http URL", async () => {
    expect(parseSingleURL("https://example.com")).toBeInstanceOf(URL);
    expect(parseSingleURL("https://example.com extra")).toBeNull();
    expect(parseSingleURL("file:///tmp/a")).toBeNull();

    const result = await summarizeUrl.execute(makeContext("not a url"));
    expect(result.success).toBe(false);
    expect(result.error).toContain("single http(s) URL");
  });

  it("strips HTML to text", () => {
    expect(
      htmlToText("<html><style>.x{}</style><body><h1>Hello &amp; bye</h1><script>x()</script></body></html>")
    ).toBe("Hello & bye");
  });

  it("fetches and summarizes HTML", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("<html><body><h1>Title</h1><p>Article body</p></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      )
    ) as unknown as typeof fetch;

    const result = await summarizeUrl.execute(makeContext("https://example.com"));

    expect(result.success).toBe(true);
    expect(result.output).toBe("URL summary");
    const call = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[1].content).toContain("Article body");
    expect(call.max_tokens).toBe(512);
  });

  it("rejects unsupported content types", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;

    await expect(fetchURLText(new URL("https://example.com"))).rejects.toThrow(
      "text/html or text/plain"
    );
  });

  it("rejects content length above 2 MB", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("too large", {
          headers: {
            "content-type": "text/plain",
            "content-length": String((2 << 20) + 1),
          },
        })
      )
    ) as unknown as typeof fetch;

    await expect(fetchURLText(new URL("https://example.com"))).rejects.toThrow(
      "2 MB limit"
    );
  });
});
