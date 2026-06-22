package automation

import (
	"sync"
	"time"
)

// maxRecentSignatures bounds the dedupe LRU so memory stays constant.
const maxRecentSignatures = 128

// Controller applies clipboard dedupe and per-action cooldown policies.
type Controller struct {
	dedupeWindow     time.Duration
	recentSignatures map[string]time.Time
	actionLastRunAt  map[string]time.Time
	mu               sync.Mutex
}

// NewController creates a controller with the given dedupe window.
func NewController(dedupeWindow time.Duration) *Controller {
	return &Controller{
		dedupeWindow:     dedupeWindow,
		recentSignatures: make(map[string]time.Time),
		actionLastRunAt:  make(map[string]time.Time),
	}
}

// ShouldSkipClipboard returns true when the clipboard signature was seen within
// the dedupe window. It tracks a bounded set of recent signatures (not just the
// immediately-previous one) so an A->B->A re-copy of A inside the window is
// suppressed.
func (c *Controller) ShouldSkipClipboard(signature string, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.dedupeWindow <= 0 {
		return false
	}

	// Drop signatures that have aged out of the window.
	for sig, seen := range c.recentSignatures {
		if now.Sub(seen) > c.dedupeWindow {
			delete(c.recentSignatures, sig)
		}
	}

	seen, ok := c.recentSignatures[signature]
	duplicate := ok && now.Sub(seen) <= c.dedupeWindow

	if !ok && len(c.recentSignatures) >= maxRecentSignatures {
		c.evictOldestLocked()
	}
	c.recentSignatures[signature] = now

	return duplicate
}

// evictOldestLocked removes the least-recently-seen signature. Caller holds mu.
func (c *Controller) evictOldestLocked() {
	var oldestSig string
	var oldestAt time.Time
	first := true
	for sig, at := range c.recentSignatures {
		if first || at.Before(oldestAt) {
			oldestSig, oldestAt, first = sig, at, false
		}
	}
	if !first {
		delete(c.recentSignatures, oldestSig)
	}
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
