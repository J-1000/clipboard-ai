package rules

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
)

var lengthExprRe = regexp.MustCompile(`^length\s*(>=|<=|!=|==|=|>|<)\s*(-?\d+)\s*$`)

// Engine evaluates trigger rules against clipboard content
type Engine struct {
	actions map[string]config.ActionConfig
}

// Match represents a triggered action
type Match struct {
	ActionName string
	Config     config.ActionConfig
}

// NewEngine creates a new rules engine
func NewEngine(actions map[string]config.ActionConfig) *Engine {
	return &Engine{actions: actions}
}

// Evaluate checks all rules against content and returns matches
func (e *Engine) Evaluate(content clipboard.Content) []Match {
	var matches []Match

	for name, action := range e.actions {
		if !action.Enabled {
			continue
		}

		if e.checkTrigger(action.Trigger, content) {
			matches = append(matches, Match{
				ActionName: name,
				Config:     action,
			})
		}
	}

	return matches
}

// checkTrigger evaluates a trigger expression
func (e *Engine) checkTrigger(trigger string, content clipboard.Content) bool {
	trigger = strings.TrimSpace(trigger)
	if trigger == "" {
		return false
	}

	parser := triggerParser{
		input:   trigger,
		engine:  e,
		content: content,
	}
	result, ok := parser.parseExpr()
	if !ok {
		return false
	}

	parser.skipSpaces()
	return parser.pos == len(parser.input) && result
}

type triggerParser struct {
	input   string
	pos     int
	engine  *Engine
	content clipboard.Content
}

func (p *triggerParser) parseExpr() (bool, bool) {
	return p.parseOr()
}

func (p *triggerParser) parseOr() (bool, bool) {
	left, ok := p.parseAnd()
	if !ok {
		return false, false
	}

	for {
		if !p.consumeKeyword("OR") {
			return left, true
		}
		right, ok := p.parseAnd()
		if !ok {
			return false, false
		}
		left = left || right
	}
}

func (p *triggerParser) parseAnd() (bool, bool) {
	left, ok := p.parseUnary()
	if !ok {
		return false, false
	}

	for {
		if !p.consumeKeyword("AND") {
			return left, true
		}
		right, ok := p.parseUnary()
		if !ok {
			return false, false
		}
		left = left && right
	}
}

func (p *triggerParser) parseUnary() (bool, bool) {
	if p.consumeKeyword("NOT") {
		result, ok := p.parseUnary()
		if !ok {
			return false, false
		}
		return !result, true
	}
	return p.parsePrimary()
}

func (p *triggerParser) parsePrimary() (bool, bool) {
	p.skipSpaces()

	if p.consumeChar('(') {
		result, ok := p.parseExpr()
		if !ok {
			return false, false
		}
		p.skipSpaces()
		if !p.consumeChar(')') {
			return false, false
		}
		return result, true
	}

	cond, ok := p.readCondition()
	if !ok {
		return false, false
	}
	return p.engine.evaluateCondition(cond, p.content), true
}

func (p *triggerParser) readCondition() (string, bool) {
	p.skipSpaces()
	start := p.pos

	for p.pos < len(p.input) {
		if p.input[p.pos] == ')' {
			break
		}
		if p.peekKeyword("AND") || p.peekKeyword("OR") {
			break
		}
		p.pos++
	}

	cond := strings.TrimSpace(p.input[start:p.pos])
	if cond == "" {
		return "", false
	}
	return cond, true
}

func (p *triggerParser) skipSpaces() {
	for p.pos < len(p.input) && isSpace(p.input[p.pos]) {
		p.pos++
	}
}

func (p *triggerParser) consumeChar(ch byte) bool {
	p.skipSpaces()
	if p.pos >= len(p.input) || p.input[p.pos] != ch {
		return false
	}
	p.pos++
	return true
}

func (p *triggerParser) consumeKeyword(kw string) bool {
	p.skipSpaces()
	if !hasKeywordAt(p.input, p.pos, kw) {
		return false
	}
	p.pos += len(kw)
	return true
}

func (p *triggerParser) peekKeyword(kw string) bool {
	return hasKeywordAt(p.input, p.pos, kw)
}

func hasKeywordAt(input string, start int, kw string) bool {
	i := start
	for i < len(input) && isSpace(input[i]) {
		i++
	}
	if i > 0 && isWordChar(input[i-1]) {
		return false
	}
	if len(input)-i < len(kw) {
		return false
	}
	if !strings.EqualFold(input[i:i+len(kw)], kw) {
		return false
	}
	end := i + len(kw)
	if end < len(input) && isWordChar(input[end]) {
		return false
	}
	return true
}

func isSpace(ch byte) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'
}

func isWordChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') ||
		(ch >= 'A' && ch <= 'Z') ||
		(ch >= '0' && ch <= '9') ||
		ch == '_'
}

// evaluateCondition checks a single trigger condition
func (e *Engine) evaluateCondition(cond string, content clipboard.Content) bool {
	cond = strings.TrimSpace(cond)

	// length > N
	if strings.HasPrefix(cond, "length") {
		return e.checkLength(cond, content.Text)
	}

	// contains:substring
	if strings.HasPrefix(cond, "contains:") {
		substr := strings.TrimPrefix(cond, "contains:")
		return strings.Contains(content.Text, substr)
	}

	// regex:pattern
	if strings.HasPrefix(cond, "regex:") {
		pattern := strings.TrimPrefix(cond, "regex:")
		matched, _ := regexp.MatchString(pattern, content.Text)
		return matched
	}

	// mime:type
	if strings.HasPrefix(cond, "mime:") {
		mimeType := strings.TrimPrefix(cond, "mime:")
		return string(content.Type) == mimeType
	}

	return false
}

// checkLength evaluates length comparisons
func (e *Engine) checkLength(cond string, text string) bool {
	length := utf8.RuneCountInString(text)
	matches := lengthExprRe.FindStringSubmatch(strings.TrimSpace(cond))
	if len(matches) != 3 {
		return false
	}

	op := matches[1]
	n, err := strconv.Atoi(matches[2])
	if err != nil {
		return false
	}

	switch op {
	case ">":
		return length > n
	case "<":
		return length < n
	case ">=":
		return length >= n
	case "<=":
		return length <= n
	case "=", "==":
		return length == n
	case "!=":
		return length != n
	default:
		return false
	}
}
