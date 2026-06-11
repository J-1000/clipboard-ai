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

var textPatterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{name: "aws_access_key", re: regexp.MustCompile(`AKIA[0-9A-Z]{16}`)},
	{name: "api_key", re: regexp.MustCompile(`(?i)api[_-]?key\s*[:=]`)},
	{name: "jwt", re: regexp.MustCompile(`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+`)},
	{name: "private_key", re: regexp.MustCompile(`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`)},
}

var cardCandidateRe = regexp.MustCompile(`(?:\d[ -]?){13,19}`)

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
		if len(digits) >= 13 && len(digits) <= 19 && luhnValid(digits) {
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
