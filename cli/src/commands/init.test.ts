import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initCommand } from "./init.js";

let cfgPath: string;

describe("initCommand", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "cbai-init-test-"));
    cfgPath = join(dir, "config.toml");
    process.env.CBAI_CONFIG_FILE = cfgPath;
    spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.CBAI_CONFIG_FILE;
  });

  it("scaffolds a default config when none exists", () => {
    initCommand();
    expect(existsSync(cfgPath)).toBe(true);
    const content = readFileSync(cfgPath, "utf8");
    expect(content).toContain("[provider]");
    expect(content).toContain("sensitive_guard");
  });

  it("does not overwrite an existing config without --force", () => {
    writeFileSync(cfgPath, "# existing\n");
    initCommand();
    expect(readFileSync(cfgPath, "utf8")).toBe("# existing\n");
  });

  it("overwrites with --force", () => {
    writeFileSync(cfgPath, "# existing\n");
    initCommand({ force: true });
    expect(readFileSync(cfgPath, "utf8")).toContain("[provider]");
  });
});
