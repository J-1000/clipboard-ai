export interface SensitiveFinding {
  type: string;
  start: number;
  end: number;
}

// Keep this pattern list in sync with agent/internal/guard/guard.go
// (enforced by the shared parity fixture).
const TEXT_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "aws_access_key", re: /(?:AKIA|ASIA)[0-9A-Z]{16}/g },
  { type: "api_key", re: /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/gi },
  { type: "jwt", re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g },
  { type: "private_key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g },
  { type: "github_token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { type: "github_pat", re: /github_pat_[A-Za-z0-9_]{22,}/g },
  { type: "slack_token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: "stripe_key", re: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { type: "google_api_key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { type: "gitlab_token", re: /glpat-[0-9A-Za-z_-]{20,}/g },
  { type: "anthropic_key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: "openai_key", re: /sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/g },
  { type: "aws_secret_key", re: /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/gi },
  { type: "bearer_token", re: /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  { type: "password", re: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"'<>]{6,}/gi },
  { type: "url_credentials", re: /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/g },
  { type: "npm_token", re: /npm_[A-Za-z0-9]{36}/g },
];

// Matches digit runs laid out the way card numbers are written: 13–19
// contiguous digits, groups of four separated consistently by spaces or dashes,
// or the 4-6-5 American Express layout. Arbitrary digit sequences such as date
// lists or phone lists do not have these shapes.
const CARD_CANDIDATE_RE =
  /\b(?:\d{13,19}|\d{4} \d{4} \d{4} \d{4}(?: \d{1,3})?|\d{4}-\d{4}-\d{4}-\d{4}(?:-\d{1,3})?|\d{4}[ -]\d{6}[ -]\d{5})\b/g;

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
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (hasAdjacentDigitGroup(text, start, end)) {
      continue;
    }
    if (isCardNumber(match[0].replace(/[^0-9]/g, ""))) {
      findings.push({ type: "credit_card", start, end });
    }
  }

  return findings;
}

function isASCIIDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isCardSeparator(ch: string | undefined): boolean {
  return ch === " " || ch === "-";
}

// Reports whether the candidate at text[start, end) is just one window of a
// longer separated digit sequence (for example a row of numbers), in which case
// it is not treated as a card number.
function hasAdjacentDigitGroup(text: string, start: number, end: number): boolean {
  if (start >= 2 && isCardSeparator(text[start - 1]) && isASCIIDigit(text[start - 2])) {
    return true;
  }
  if (end + 1 < text.length && isCardSeparator(text[end]) && isASCIIDigit(text[end + 1])) {
    return true;
  }
  return false;
}

// Requires 13–19 digits, a leading digit used by the major card networks (2–6),
// and a valid Luhn checksum.
function isCardNumber(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  if (digits[0] < "2" || digits[0] > "6") {
    return false;
  }
  return luhnValid(digits);
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
