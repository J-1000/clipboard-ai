import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { builtinActions } from "./builtin-actions.js";
import { createActionRegistry, resolveAction } from "./action-registry.js";

// Regression guard for `summarize_url` (and any future config action) being
// documented/triggerable in configs/default.toml but absent from the registry —
// which made the daemon run `cbai run summarize_url` and fail. Every action
// named in default.toml (active OR shown as a commented example) must resolve.
describe("configs/default.toml action coverage", () => {
  const tomlPath = join(import.meta.dir, "..", "..", "..", "configs", "default.toml");
  const toml = readFileSync(tomlPath, "utf8");
  const registry = createActionRegistry(builtinActions);

  const names = Array.from(toml.matchAll(/\[actions\.([A-Za-z0-9_-]+)\]/g), (m) => m[1]);

  it("references at least summarize, explain, and summarize_url", () => {
    expect(names).toContain("summarize");
    expect(names).toContain("explain");
    expect(names).toContain("summarize_url");
  });

  it.each(Array.from(new Set(names)))("resolves action %s", (name) => {
    expect(resolveAction(registry, name)).toBeTruthy();
  });
});
