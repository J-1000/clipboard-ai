import { describe, expect, it } from "bun:test";
import { promptActionFromConfig } from "./run-action.js";
import { makeConfig } from "../test-helpers.js";
import type { AIClient } from "./ai.js";

function fakeAI(capture: (prompt: string) => void): AIClient {
  return {
    generate: async (prompt: string) => {
      capture(prompt);
      return { content: "ok", model: "m" };
    },
  } as unknown as AIClient;
}

describe("promptActionFromConfig", () => {
  it("returns null when the action has no prompt", () => {
    const config = makeConfig({ actions: { foo: { enabled: true, trigger: "" } } });
    expect(promptActionFromConfig("foo", config)).toBeNull();
  });

  it("appends clipboard text when there is no placeholder", async () => {
    const config = makeConfig({
      actions: { shout: { enabled: true, trigger: "", prompt: "Rewrite in all caps:" } },
    });
    const action = promptActionFromConfig("shout", config);
    expect(action).not.toBeNull();
    let seen = "";
    await action!.run({ text: "hello", ai: fakeAI((p) => (seen = p)), config, args: [] });
    expect(seen).toBe("Rewrite in all caps:\n\nhello");
  });

  it("interpolates {{input}} and {{args}} placeholders", async () => {
    const config = makeConfig({
      actions: {
        ask: { enabled: true, trigger: "", prompt: "In {{args}}: {{input}}" },
      },
    });
    const action = promptActionFromConfig("ask", config);
    let seen = "";
    await action!.run({ text: "the text", ai: fakeAI((p) => (seen = p)), config, args: ["French"] });
    expect(seen).toBe("In French: the text");
  });
});
