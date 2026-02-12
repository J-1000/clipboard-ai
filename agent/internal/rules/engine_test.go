package rules

import (
	"sort"
	"testing"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
)

func makeContent(text string, contentType clipboard.ContentType) clipboard.Content {
	return clipboard.Content{
		Text: text,
		Type: contentType,
	}
}

func TestEvaluate_LengthGreaterThan(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"summarize": {Enabled: true, Trigger: "length > 10"},
	})

	// Match: 11 chars > 10
	matches := engine.Evaluate(makeContent("hello world", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].ActionName != "summarize" {
		t.Fatalf("expected action 'summarize', got %q", matches[0].ActionName)
	}

	// No match: 5 chars <= 10
	matches = engine.Evaluate(makeContent("hello", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_LengthLessThan(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"short": {Enabled: true, Trigger: "length < 5"},
	})

	matches := engine.Evaluate(makeContent("hi", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("hello world", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_LengthEquals(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"exact": {Enabled: true, Trigger: "length = 5"},
	})

	matches := engine.Evaluate(makeContent("hello", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("hi", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_Contains(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"finder": {Enabled: true, Trigger: "contains:error"},
	})

	matches := engine.Evaluate(makeContent("an error occurred", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("all good", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_Regex(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"phone": {Enabled: true, Trigger: `regex:\d{3}-\d{4}`},
	})

	matches := engine.Evaluate(makeContent("call 555-1234", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("no phone here", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_Mime(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"explain": {Enabled: true, Trigger: "mime:code"},
	})

	matches := engine.Evaluate(makeContent("func main() {}", clipboard.ContentTypeCode))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("just text", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_AND(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"both": {Enabled: true, Trigger: "length > 5 AND contains:hello"},
	})

	// Both conditions met
	matches := engine.Evaluate(makeContent("hello world", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	// Only length met
	matches = engine.Evaluate(makeContent("goodbye world", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}

	// Only contains met
	matches = engine.Evaluate(makeContent("hello", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_OR(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"either": {Enabled: true, Trigger: "contains:error OR contains:warning"},
	})

	matches := engine.Evaluate(makeContent("error found", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("warning issued", clipboard.ContentTypeText))
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	matches = engine.Evaluate(makeContent("all good", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches, got %d", len(matches))
	}
}

func TestEvaluate_DisabledAction(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"disabled": {Enabled: false, Trigger: "length > 0"},
	})

	matches := engine.Evaluate(makeContent("some text", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches for disabled action, got %d", len(matches))
	}
}

func TestEvaluate_EmptyTrigger(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"empty": {Enabled: true, Trigger: ""},
	})

	matches := engine.Evaluate(makeContent("some text", clipboard.ContentTypeText))
	if len(matches) != 0 {
		t.Fatalf("expected 0 matches for empty trigger, got %d", len(matches))
	}
}

func TestEvaluate_MultipleActions(t *testing.T) {
	engine := NewEngine(map[string]config.ActionConfig{
		"action_a": {Enabled: true, Trigger: "length > 5"},
		"action_b": {Enabled: true, Trigger: "contains:hello"},
	})

	matches := engine.Evaluate(makeContent("hello world", clipboard.ContentTypeText))
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matches))
	}

	// Sort by action name for deterministic assertion (map iteration is non-deterministic)
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].ActionName < matches[j].ActionName
	})

	if matches[0].ActionName != "action_a" {
		t.Fatalf("expected first match 'action_a', got %q", matches[0].ActionName)
	}
	if matches[1].ActionName != "action_b" {
		t.Fatalf("expected second match 'action_b', got %q", matches[1].ActionName)
	}
}
