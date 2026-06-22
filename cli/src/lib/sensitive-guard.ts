export interface SensitiveFinding {
  type: string;
  start: number;
  end: number;
}

// Keep this pattern list in sync with agent/internal/guard/guard.go
// (enforced by the shared parity fixture).
const TEXT_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "aws_access_key", re: /AKIA[0-9A-Z]{16}/g },
  { type: "api_key", re: /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/gi },
  { type: "jwt", re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g },
  { type: "private_key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { type: "github_token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { type: "github_pat", re: /github_pat_[A-Za-z0-9_]{22,}/g },
  { type: "slack_token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: "stripe_key", re: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { type: "google_api_key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { type: "gitlab_token", re: /glpat-[0-9A-Za-z_-]{20,}/g },
  { type: "ssh_public_key", re: /ssh-(?:rsa|ed25519) AAAA[0-9A-Za-z+/]+/g },
];

const CARD_CANDIDATE_RE = /(?:\d[ -]?){13,}/g;

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
    if (luhnWindowValid(digits)) {
      findings.push({
        type: "credit_card",
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      });
    }
  }

  return findings;
}

// Validates a digit run as a card number. A 13–19 digit run is checked as-is; a
// longer run is treated as a card embedded in a larger sequence, so every 13–19
// digit window is slid across it. (Sliding is limited to oversized runs to avoid
// spuriously matching a Luhn-valid sub-window of a single invalid card number.)
function luhnWindowValid(digits: string): boolean {
  const n = digits.length;
  if (n < 13) {
    return false;
  }
  if (n <= 19) {
    return luhnValid(digits);
  }
  for (let size = 13; size <= 19; size += 1) {
    for (let i = 0; i + size <= n; i += 1) {
      if (luhnValid(digits.slice(i, i + size))) {
        return true;
      }
    }
  }
  return false;
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
