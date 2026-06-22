import { describe, expect, it } from "bun:test";
import yargs from "yargs";

// Guards the parser contract index.ts relies on to prevent flag injection: the
// daemon spawns `cbai run <action> -- <args...>`, so tokens after `--` must land
// in argv["--"] (merged into action args) and must NOT toggle global options
// like --force. If a yargs upgrade changed populate-- defaults, this fails.
function parseRun(argv: string[]): { action: string; args: string[]; force: boolean } {
  let captured = { action: "", args: [] as string[], force: false };
  yargs(argv)
    .parserConfiguration({ "populate--": true })
    .option("force", { type: "boolean", default: false })
    .command(
      "run <action> [args..]",
      "run",
      (y) => y.positional("action", { type: "string" }).positional("args", { type: "string" }),
      (a) => {
        const positional = (a.args as string[] | undefined) ?? [];
        const afterDashDash = (a["--"] as string[] | undefined) ?? [];
        captured = {
          action: a.action as string,
          args: [...positional, ...afterDashDash],
          force: a.force as boolean,
        };
      }
    )
    .parse();
  return captured;
}

describe("run command argument parsing", () => {
  it("keeps a legitimate arg passed after --", () => {
    const r = parseRun(["run", "translate", "--", "Spanish"]);
    expect(r.action).toBe("translate");
    expect(r.args).toEqual(["Spanish"]);
    expect(r.force).toBe(false);
  });

  it("does not let an injected --force after -- enable force", () => {
    const r = parseRun(["run", "summary", "--", "--force"]);
    expect(r.force).toBe(false);
    expect(r.args).toEqual(["--force"]);
  });

  it("still honors an explicit global --force before the action", () => {
    const r = parseRun(["run", "summary", "--force"]);
    expect(r.force).toBe(true);
  });
});
