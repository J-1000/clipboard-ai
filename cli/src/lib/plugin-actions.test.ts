import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadPluginActions } from "./plugin-actions.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cbai-plugin-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadPluginActions", () => {
  it("loads default-exported plugins", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "hello.mjs"),
      `export default {
        id: "hello",
        description: "Says hello",
        outputTitle: "Hello",
        run: async ({ text }) => text.toUpperCase(),
      };`
    );

    const actions = await loadPluginActions(dir);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("hello");

    const result = await actions[0]!.run({
      text: "hi",
      ai: {} as never,
      config: {} as never,
      args: [],
    });
    expect(result).toBe("HI");
  });

  it("loads plugins exported as metadata + run", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "echo.mjs"),
      `export const metadata = {
        id: "echo",
        aliases: ["repeat"],
        outputTitle: "Echo",
      };
      export async function run({ args }) {
        return args.join(",");
      }`
    );

    const actions = await loadPluginActions(dir);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.aliases).toEqual(["repeat"]);

    const result = await actions[0]!.run({
      text: "",
      ai: {} as never,
      config: {} as never,
      args: ["a", "b"],
    });
    expect(result).toBe("a,b");
  });

  it("ignores unsupported file extensions", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "not-a-plugin.txt"), "hello");

    const actions = await loadPluginActions(dir);
    expect(actions).toHaveLength(0);
  });
});
