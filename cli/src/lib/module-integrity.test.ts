import { describe, it, expect } from "bun:test";

// Regression guard for the cross-file `mock.module` leakage that once produced
// ~50 false whole-suite failures: a test file would register a PARTIAL module
// shape globally (e.g. `mock.module("./client.js", () => ({ getConfig }))`),
// and later files importing the real module saw a stale partial mock
// (`getStatus is not a function`). The suite is now dependency-injected and must
// not reintroduce that pattern, so assert the real public surface is intact when
// imported as part of the FULL suite. If a partial module mock leaks here, these
// imports lose members and the test fails — exactly the symptom we regressed on.

describe("module integrity (no cross-file mock leakage)", () => {
  it("client.js exposes its full IPC surface", async () => {
    const client = await import("./client.js");
    expect(typeof client.getStatus).toBe("function");
    expect(typeof client.getClipboard).toBe("function");
    expect(typeof client.getConfig).toBe("function");
  });

  it("ai.js exposes the AIClient class", async () => {
    const ai = await import("./ai.js");
    expect(typeof ai.AIClient).toBe("function");
    expect(typeof ai.AIClient.prototype.summarize).toBe("function");
    expect(typeof ai.AIClient.prototype.generate).toBe("function");
  });

  it("collaborator libs expose their real exports", async () => {
    const [clipboard, safeMode, input, history, guard, registry] = await Promise.all([
      import("./clipboard.js"),
      import("./safe-mode.js"),
      import("./input.js"),
      import("./history.js"),
      import("./sensitive-guard.js"),
      import("./action-registry.js"),
    ]);
    expect(typeof clipboard.copyToClipboard).toBe("function");
    expect(typeof safeMode.enforceSafeMode).toBe("function");
    expect(typeof input.getInput).toBe("function");
    expect(typeof history.appendHistoryRecord).toBe("function");
    expect(typeof guard.scanSensitiveText).toBe("function");
    expect(typeof registry.getActionRegistry).toBe("function");
  });
});
