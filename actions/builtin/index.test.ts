import { describe, it, expect, mock } from "bun:test";

const mockCreate = mock((_params: Record<string, unknown>) =>
  Promise.resolve({
    choices: [{ message: { content: "mock" } }],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(public opts: Record<string, unknown>) {}
  },
}));

const { builtinActions, summarize, explain, translate, extract, classify, summarizeUrl } =
  await import("./index.js");

describe("builtin actions index", () => {
  it("exports all builtin actions individually", () => {
    expect(summarize).toBeDefined();
    expect(explain).toBeDefined();
    expect(translate).toBeDefined();
    expect(extract).toBeDefined();
    expect(classify).toBeDefined();
    expect(summarizeUrl).toBeDefined();
  });

  it("exports builtinActions record with all actions", () => {
    expect(Object.keys(builtinActions)).toHaveLength(6);
    expect(builtinActions.summarize).toBeDefined();
    expect(builtinActions.explain).toBeDefined();
    expect(builtinActions.translate).toBeDefined();
    expect(builtinActions.extract).toBeDefined();
    expect(builtinActions.classify).toBeDefined();
    expect(builtinActions.summarize_url).toBeDefined();
  });

  it("each action has metadata with id", () => {
    for (const [name, action] of Object.entries(builtinActions)) {
      expect(action.metadata.id).toBe(name);
    }
  });

  it("each action has an execute function", () => {
    for (const action of Object.values(builtinActions)) {
      expect(typeof action.execute).toBe("function");
    }
  });
});
