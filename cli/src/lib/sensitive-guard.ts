export interface SensitiveFinding {
  type: string;
  start: number;
  end: number;
}

// Keep this pattern list in sync with agent/internal/guard/guard.go.
const TEXT_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  { type: "api_key", re: /api[_-]?key\s*[:=]/gi },
  { type: "jwt", re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g },
  { type: "private_key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
];

const CARD_CANDIDATE_RE = /(?:\d[ -]?){13,19}/g;

export function scanSensitiveText(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];

  for (const pattern of TEXT_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of text.matchAll(pattern.re)) {
      findings.push({
        type: pattern.type,
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      });
    }
  }

  CARD_CANDIDATE_RE.lastIndex = 0;
  for (const match of text.matchAll(CARD_CANDIDATE_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      findings.push({
        type: "credit_card",
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      });
    }
  }

  return findings;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    double = !double;
  }

  return sum > 0 && sum % 10 === 0;
}
