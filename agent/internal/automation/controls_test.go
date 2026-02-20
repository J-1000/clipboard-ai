package automation

import (
	"testing"
	"time"
)

func TestShouldSkipClipboard(t *testing.T) {
	c := NewController(1 * time.Second)
	now := time.Now()

	if c.ShouldSkipClipboard("hello", now) {
		t.Fatal("expected first clipboard value to pass")
	}

	if !c.ShouldSkipClipboard("hello", now.Add(500*time.Millisecond)) {
		t.Fatal("expected duplicate clipboard value inside window to skip")
	}

	if c.ShouldSkipClipboard("hello", now.Add(2*time.Second)) {
		t.Fatal("expected duplicate clipboard value outside window to pass")
	}
}

func TestShouldSkipClipboard_Disabled(t *testing.T) {
	c := NewController(0)
	now := time.Now()

	if c.ShouldSkipClipboard("same", now) {
		t.Fatal("expected dedupe disabled to never skip")
	}
	if c.ShouldSkipClipboard("same", now.Add(1*time.Millisecond)) {
		t.Fatal("expected dedupe disabled to never skip")
	}
}

func TestAllowActionCooldown(t *testing.T) {
	c := NewController(0)
	now := time.Now()

	if !c.AllowAction("summarize", 1*time.Second, now) {
		t.Fatal("expected first action run to pass")
	}
	if c.AllowAction("summarize", 1*time.Second, now.Add(200*time.Millisecond)) {
		t.Fatal("expected action within cooldown to block")
	}
	if !c.AllowAction("summarize", 1*time.Second, now.Add(1500*time.Millisecond)) {
		t.Fatal("expected action after cooldown to pass")
	}
}

func TestAllowActionDifferentActions(t *testing.T) {
	c := NewController(0)
	now := time.Now()

	if !c.AllowAction("summarize", 1*time.Second, now) {
		t.Fatal("expected summarize to pass")
	}
	if !c.AllowAction("explain", 1*time.Second, now.Add(100*time.Millisecond)) {
		t.Fatal("expected explain to pass independently")
	}
}
