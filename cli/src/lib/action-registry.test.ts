import { describe, expect, it } from "bun:test";
import { createActionRegistry, resolveAction } from "./action-registry.js";
import type { ActionDefinition } from "./action-types.js";

const noop = async () => "ok";

describe("action-registry", () => {
  it("resolves actions by id", () => {
    const actions: ActionDefinition[] = [
      { id: "summary", description: "", outputTitle: "", run: noop },
    ];

    const registry = createActionRegistry(actions);
    expect(resolveAction(registry, "summary")?.id).toBe("summary");
  });

  it("resolves actions by alias", () => {
    const actions: ActionDefinition[] = [
      { id: "summary", aliases: ["summarize"], description: "", outputTitle: "", run: noop },
    ];

    const registry = createActionRegistry(actions);
    expect(resolveAction(registry, "summarize")?.id).toBe("summary");
  });

  it("returns undefined for unknown actions", () => {
    const actions: ActionDefinition[] = [
      { id: "summary", description: "", outputTitle: "", run: noop },
    ];

    const registry = createActionRegistry(actions);
    expect(resolveAction(registry, "unknown")).toBeUndefined();
  });
});
