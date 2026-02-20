package rules

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
)

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
	if trigger == "" {
		return false
	}

	// Handle OR
	if strings.Contains(trigger, " OR ") {
		parts := strings.Split(trigger, " OR ")
		for _, part := range parts {
			if e.checkTrigger(strings.TrimSpace(part), content) {
				return true
			}
		}
		return false
	}

	// Handle AND
	if strings.Contains(trigger, " AND ") {
		parts := strings.Split(trigger, " AND ")
		for _, part := range parts {
			if !e.checkTrigger(strings.TrimSpace(part), content) {
				return false
			}
		}
		return true
	}

	// Single condition
	return e.evaluateCondition(trigger, content)
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

	// length > N
	if strings.Contains(cond, ">") {
		parts := strings.Split(cond, ">")
		if len(parts) == 2 {
			n, err := strconv.Atoi(strings.TrimSpace(parts[1]))
			if err == nil {
				return length > n
			}
		}
	}

	// length < N
	if strings.Contains(cond, "<") {
		parts := strings.Split(cond, "<")
		if len(parts) == 2 {
			n, err := strconv.Atoi(strings.TrimSpace(parts[1]))
			if err == nil {
				return length < n
			}
		}
	}

	// length = N
	if strings.Contains(cond, "=") {
		parts := strings.Split(cond, "=")
		if len(parts) == 2 {
			n, err := strconv.Atoi(strings.TrimSpace(parts[1]))
			if err == nil {
				return length == n
			}
		}
	}

	return false
}
