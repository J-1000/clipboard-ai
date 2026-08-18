package automation

import (
	"context"
	"sync"
)

// ConcurrencyGate bounds in-flight actions and supports changing the limit at
// runtime. A limit of zero means unlimited.
type ConcurrencyGate struct {
	mu      sync.Mutex
	limit   int
	active  int
	changed chan struct{}
}

func NewConcurrencyGate(limit int) *ConcurrencyGate {
	return &ConcurrencyGate{limit: limit, changed: make(chan struct{})}
}

// Acquire waits for capacity or context cancellation and returns a release
// callback when successful.
func (g *ConcurrencyGate) Acquire(ctx context.Context) (func(), bool) {
	for {
		g.mu.Lock()
		if g.limit <= 0 || g.active < g.limit {
			g.active++
			g.mu.Unlock()
			return g.release, true
		}
		changed := g.changed
		g.mu.Unlock()

		select {
		case <-ctx.Done():
			return func() {}, false
		case <-changed:
		}
	}
}

// SetLimit applies a new maximum immediately. Lowering the limit never cancels
// running work; it delays new acquisitions until active work falls below it.
func (g *ConcurrencyGate) SetLimit(limit int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.limit = limit
	g.broadcastLocked()
}

func (g *ConcurrencyGate) release() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.active > 0 {
		g.active--
	}
	g.broadcastLocked()
}

func (g *ConcurrencyGate) broadcastLocked() {
	close(g.changed)
	g.changed = make(chan struct{})
}
