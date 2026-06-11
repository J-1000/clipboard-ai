import { describe, expect, it } from "bun:test";
import { scanSensitiveText } from "./sensitive-guard.js";

describe("scanSensitiveText", () => {
  it("detects sensitive patterns", () => {
    const cases: Array<[string, string]> = [
      ["key AKIA1234567890ABCDEF copied", "aws_access_key"],
      ["api-key: secret", "api_key"],
      ["token eyJabc.eyJdef.signature", "jwt"],
      ["-----BEGIN RSA PRIVATE KEY-----", "private_key"],
      ["card 4111 1111 1111 1111", "credit_card"],
    ];

    for (const [text, type] of cases) {
      expect(scanSensitiveText(text).map((finding) => finding.type)).toContain(type);
    }
  });

  it("ignores invalid credit card candidates", () => {
    expect(scanSensitiveText("card 4111 1111 1111 1112")).toHaveLength(0);
  });
});
