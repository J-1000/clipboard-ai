import { describe, it, expect, mock } from "bun:test";

const mockCreate = mock(() =>
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

const { builtinActions, summarize, explain, translate, extract, classify } =
  await import("./index.js");

describe("builtin actions index", () => {
  it("exports all five actions individually", () => {
    expect(summarize).toBeDefined();
    expect(explain).toBeDefined();
    expect(translate).toBeDefined();
    expect(extract).toBeDefined();
    expect(classify).toBeDefined();
  });

  it("exports builtinActions record with all actions", () => {
    expect(Object.keys(builtinActions)).toHaveLength(5);
    expect(builtinActions.summarize).toBeDefined();
    expect(builtinActions.explain).toBeDefined();
    expect(builtinActions.translate).toBeDefined();
    expect(builtinActions.extract).toBeDefined();
    expect(builtinActions.classify).toBeDefined();
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
