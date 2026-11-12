package guard

import (
	"regexp"
	"sort"
	"strings"
)

type Finding struct {
	Type  string
	Start int
	End   int
}

// textPatterns are high-precision secret signatures. Keep this list in sync
// with cli/src/lib/sensitive-guard.ts (enforced by the shared parity fixture).
var textPatterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{name: "aws_access_key", re: regexp.MustCompile(`(?:AKIA|ASIA)[0-9A-Z]{16}`)},
	{name: "api_key", re: regexp.MustCompile(`(?i)api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}`)},
	{name: "jwt", re: regexp.MustCompile(`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+`)},
	{name: "private_key", re: regexp.MustCompile(`-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----`)},
	{name: "github_token", re: regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{36,}`)},
	{name: "github_pat", re: regexp.MustCompile(`github_pat_[A-Za-z0-9_]{22,}`)},
	{name: "slack_token", re: regexp.MustCompile(`xox[baprs]-[A-Za-z0-9-]{10,}`)},
	{name: "stripe_key", re: regexp.MustCompile(`(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}`)},
	{name: "google_api_key", re: regexp.MustCompile(`AIza[0-9A-Za-z_-]{35}`)},
	{name: "gitlab_token", re: regexp.MustCompile(`glpat-[0-9A-Za-z_-]{20,}`)},
	{name: "anthropic_key", re: regexp.MustCompile(`sk-ant-[A-Za-z0-9_-]{20,}`)},
	{name: "openai_key", re: regexp.MustCompile(`sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})`)},
	{name: "aws_secret_key", re: regexp.MustCompile(`(?i)aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}`)},
	{name: "bearer_token", re: regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{20,}`)},
	{name: "password", re: regexp.MustCompile(`(?i)\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"'<>]{6,}`)},
	{name: "url_credentials", re: regexp.MustCompile(`[A-Za-z][A-Za-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@`)},
	{name: "npm_token", re: regexp.MustCompile(`npm_[A-Za-z0-9]{36}`)},
}

// cardCandidateRe matches digit runs laid out the way card numbers are written:
// 13–19 contiguous digits, groups of four separated consistently by spaces or
// dashes, or the 4-6-5 American Express layout. Arbitrary digit sequences such
// as date lists or phone lists do not have these shapes.
var cardCandidateRe = regexp.MustCompile(
	`\b(?:\d{13,19}|\d{4} \d{4} \d{4} \d{4}(?: \d{1,3})?|\d{4}-\d{4}-\d{4}-\d{4}(?:-\d{1,3})?|\d{4}[ -]\d{6}[ -]\d{5})\b`,
)

func Scan(text string) []Finding {
	var findings []Finding

	for _, pattern := range textPatterns {
		for _, loc := range pattern.re.FindAllStringIndex(text, -1) {
			findings = append(findings, Finding{
				Type:  pattern.name,
				Start: loc[0],
				End:   loc[1],
			})
		}
	}

	for _, loc := range cardCandidateRe.FindAllStringIndex(text, -1) {
		if hasAdjacentDigitGroup(text, loc[0], loc[1]) {
			continue
		}
		if isCardNumber(digitsOnly(text[loc[0]:loc[1]])) {
			findings = append(findings, Finding{
				Type:  "credit_card",
				Start: loc[0],
				End:   loc[1],
			})
		}
	}

	return findings
}

func digitsOnly(value string) string {
	var b strings.Builder
	for i := 0; i < len(value); i++ {
		if isASCIIDigit(value[i]) {
			b.WriteByte(value[i])
		}
	}
	return b.String()
}

func isASCIIDigit(ch byte) bool {
	return ch >= '0' && ch <= '9'
}

func isCardSeparator(ch byte) bool {
	return ch == ' ' || ch == '-'
}

// hasAdjacentDigitGroup reports whether the candidate at text[start:end] is
// just one window of a longer separated digit sequence (for example a row of
// numbers), in which case it is not treated as a card number.
func hasAdjacentDigitGroup(text string, start, end int) bool {
	if start >= 2 && isCardSeparator(text[start-1]) && isASCIIDigit(text[start-2]) {
		return true
	}
	if end+1 < len(text) && isCardSeparator(text[end]) && isASCIIDigit(text[end+1]) {
		return true
	}
	return false
}

// isCardNumber requires 13–19 digits, a leading digit used by the major card
// networks (2–6), and a valid Luhn checksum.
func isCardNumber(digits string) bool {
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	if digits[0] < '2' || digits[0] > '6' {
		return false
	}
	return luhnValid(digits)
}

func luhnValid(digits string) bool {
	sum := 0
	double := false

	for i := len(digits) - 1; i >= 0; i-- {
		n := int(digits[i] - '0')
		if double {
			n *= 2
			if n > 9 {
				n -= 9
			}
		}
		sum += n
		double = !double
	}

	return sum > 0 && sum%10 == 0
}

// Types returns the distinct finding types, sorted, for logs and notifications.
func Types(findings []Finding) []string {
	seen := make(map[string]struct{}, len(findings))
	types := make([]string, 0, len(findings))
	for _, finding := range findings {
		if _, ok := seen[finding.Type]; ok {
			continue
		}
		seen[finding.Type] = struct{}{}
		types = append(types, finding.Type)
	}
	sort.Strings(types)
	return types
}
