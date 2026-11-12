import { describe, expect, it, mock } from "bun:test";
import { builtinActions } from "./builtin-actions.js";
import { fakeAIClient, makeConfig } from "../test-helpers.js";

describe("translate action", () => {
  const translate = builtinActions.find((action) => action.id === "translate")!;

  async function targetLanguageFor(args: string[]): Promise<string> {
    const translateMock = mock((_text: string, _lang: string) => Promise.resolve("ok"));
    await translate.run({
      text: "hello",
      ai: fakeAIClient({ translate: translateMock }),
      config: makeConfig(),
      args,
    });
    return translateMock.mock.calls[0][1];
  }

  it("joins a multi-word target language", async () => {
    expect(await targetLanguageFor(["Brazilian", "Portuguese"])).toBe("Brazilian Portuguese");
  });

  it("defaults to English when no language is given", async () => {
    expect(await targetLanguageFor([])).toBe("English");
  });
});
