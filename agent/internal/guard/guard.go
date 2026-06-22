package guard

import (
	"regexp"
	"strings"
	"unicode"
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
	{name: "aws_access_key", re: regexp.MustCompile(`AKIA[0-9A-Z]{16}`)},
	{name: "api_key", re: regexp.MustCompile(`(?i)api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}`)},
	{name: "jwt", re: regexp.MustCompile(`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+`)},
	{name: "private_key", re: regexp.MustCompile(`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`)},
	{name: "github_token", re: regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{36,}`)},
	{name: "github_pat", re: regexp.MustCompile(`github_pat_[A-Za-z0-9_]{22,}`)},
	{name: "slack_token", re: regexp.MustCompile(`xox[baprs]-[A-Za-z0-9-]{10,}`)},
	{name: "stripe_key", re: regexp.MustCompile(`(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}`)},
	{name: "google_api_key", re: regexp.MustCompile(`AIza[0-9A-Za-z_-]{35}`)},
	{name: "gitlab_token", re: regexp.MustCompile(`glpat-[0-9A-Za-z_-]{20,}`)},
	{name: "ssh_public_key", re: regexp.MustCompile(`ssh-(?:rsa|ed25519) AAAA[0-9A-Za-z+/]+`)},
}

var cardCandidateRe = regexp.MustCompile(`(?:\d[ -]?){13,}`)

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
		candidate := text[loc[0]:loc[1]]
		digits := digitsOnly(candidate)
		if luhnWindowValid(digits) {
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
	for _, r := range value {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// luhnWindowValid slides every 13–19 digit window across a run so a card number
// embedded in a longer digit sequence is still caught.
func luhnWindowValid(digits string) bool {
	n := len(digits)
	for size := 13; size <= 19 && size <= n; size++ {
		for i := 0; i+size <= n; i++ {
			if luhnValid(digits[i : i+size]) {
				return true
			}
		}
	}
	return false
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
