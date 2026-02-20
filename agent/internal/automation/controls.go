package automation

import (
	"sync"
	"time"
)

// Controller applies clipboard dedupe and per-action cooldown policies.
type Controller struct {
	dedupeWindow      time.Duration
	lastClipboardText string
	lastClipboardAt   time.Time
	actionLastRunAt   map[string]time.Time
	mu                sync.Mutex
}

// NewController creates a controller with the given dedupe window.
func NewController(dedupeWindow time.Duration) *Controller {
	return &Controller{
		dedupeWindow:    dedupeWindow,
		actionLastRunAt: make(map[string]time.Time),
	}
}

// ShouldSkipClipboard returns true when the clipboard text is a duplicate inside the dedupe window.
func (c *Controller) ShouldSkipClipboard(text string, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	isDuplicate := c.dedupeWindow > 0 &&
		text == c.lastClipboardText &&
		!c.lastClipboardAt.IsZero() &&
		now.Sub(c.lastClipboardAt) <= c.dedupeWindow

	c.lastClipboardText = text
	c.lastClipboardAt = now

	return isDuplicate
}

// AllowAction returns true when action cooldown permits execution and records the action run timestamp.
func (c *Controller) AllowAction(action string, cooldown time.Duration, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if cooldown > 0 {
		if last, ok := c.actionLastRunAt[action]; ok && now.Sub(last) < cooldown {
			return false
		}
	}

	c.actionLastRunAt[action] = now
	return true
}
