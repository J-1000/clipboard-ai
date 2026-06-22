package rules

import (
	"log/slog"
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
	regexes map[string]*regexp.Regexp
}

// Match represents a triggered action
type Match struct {
	ActionName string
	Config     config.ActionConfig
}

// NewEngine creates a new rules engine. Regex operands are compiled only for
// ENABLED actions, and a single invalid pattern is logged and skipped rather
// than aborting construction — one bad trigger must not stop the daemon.
func NewEngine(actions map[string]config.ActionConfig) (*Engine, error) {
	e := &Engine{actions: actions, regexes: make(map[string]*regexp.Regexp)}
	for actionName, action := range actions {
		if !action.Enabled {
			continue
		}
		for _, pattern := range e.regexOperands(action.Trigger) {
			if _, ok := e.regexes[pattern]; ok {
				continue
			}
			compiled, err := regexp.Compile(pattern)
			if err != nil {
				slog.Warn("skipping invalid regex trigger",
					"action", actionName,
					"pattern", pattern,
					"error", err,
				)
				continue
			}
			e.regexes[pattern] = compiled
		}
	}

	return e, nil
}

// regexOperands walks a trigger expression and returns the operands of all
// regex: conditions, using the same quote-aware parser as evaluation.
func (e *Engine) regexOperands(trigger string) []string {
	var collected []string
	p := triggerParser{input: strings.TrimSpace(trigger), engine: e, collectRegex: &collected}
	p.parseExpr()
	return collected
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
	// When set, conditions are not evaluated; regex: operands are collected here
	// (used by NewEngine to compile patterns up front).
	collectRegex *[]string
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
	if p.collectRegex != nil {
		if operand, ok := strings.CutPrefix(cond, "regex:"); ok {
			*p.collectRegex = append(*p.collectRegex, operand)
		}
		return true, true
	}
	return p.engine.evaluateCondition(cond, p.content), true
}

func (p *triggerParser) readCondition() (string, bool) {
	p.skipSpaces()

	// regex:/contains: operands are opaque. Support quoting so an operand may
	// contain DSL-significant characters like ) AND OR without being split:
	//   regex:"(https?)://"   contains:"foo AND bar"
	for _, prefix := range []string{"regex:", "contains:"} {
		if strings.HasPrefix(p.input[p.pos:], prefix) {
			return p.readOperandCondition(prefix)
		}
	}

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

// readOperandCondition reads a regex:/contains: condition whose operand is
// treated opaquely. A quoted operand may contain any character; an unquoted
// operand still stops at a ) or AND/OR keyword for backward compatibility.
func (p *triggerParser) readOperandCondition(prefix string) (string, bool) {
	p.pos += len(prefix)

	if p.pos < len(p.input) && (p.input[p.pos] == '"' || p.input[p.pos] == '\'') {
		quote := p.input[p.pos]
		p.pos++
		start := p.pos
		for p.pos < len(p.input) && p.input[p.pos] != quote {
			p.pos++
		}
		if p.pos >= len(p.input) {
			return "", false // unterminated quote
		}
		operand := p.input[start:p.pos]
		p.pos++ // consume closing quote
		return prefix + operand, true
	}

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
	operand := strings.TrimRight(p.input[start:p.pos], " \t\r\n")
	return prefix + operand, true
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
		compiled, ok := e.regexes[pattern]
		return ok && compiled.MatchString(content.Text)
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
