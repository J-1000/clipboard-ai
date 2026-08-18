package privacy

import (
	"strings"
	"sync"
	"time"
)

const (
	ReasonAllowed       = "allowed"
	ReasonPaused        = "paused"
	ReasonSnoozed       = "snoozed"
	ReasonDeniedApp     = "application denied"
	ReasonAppNotAllowed = "application not allowlisted"
)

// Application identifies the foreground app at the time the pasteboard
// changes. BundleID is preferred; Name is a fallback for apps without one.
type Application struct {
	Name     string `json:"name,omitempty"`
	BundleID string `json:"bundle_id,omitempty"`
}

type Decision struct {
	Allowed     bool
	Reason      string
	Application Application
}

type Snapshot struct {
	Paused       bool
	SnoozedUntil time.Time
	Monitoring   bool
	AppAllowlist []string
	AppDenylist  []string
}

// Controller owns ephemeral pause/snooze state plus hot-reloadable app policy.
type Controller struct {
	mu           sync.RWMutex
	paused       bool
	snoozedUntil time.Time
	allowlist    []string
	denylist     []string
}

func NewController(startPaused bool, allowlist, denylist []string) *Controller {
	return &Controller{
		paused:    startPaused,
		allowlist: normalizedCopy(allowlist),
		denylist:  normalizedCopy(denylist),
	}
}

func (c *Controller) Pause() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.paused = true
}

func (c *Controller) Snooze(duration time.Duration, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.snoozedUntil = now.Add(duration)
}

func (c *Controller) Resume() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.paused = false
	c.snoozedUntil = time.Time{}
}

func (c *Controller) UpdatePolicy(allowlist, denylist []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.allowlist = normalizedCopy(allowlist)
	c.denylist = normalizedCopy(denylist)
}

func (c *Controller) Decision(app Application, now time.Time) Decision {
	c.mu.RLock()
	defer c.mu.RUnlock()

	decision := Decision{Allowed: false, Application: app}
	if c.paused {
		decision.Reason = ReasonPaused
		return decision
	}
	if now.Before(c.snoozedUntil) {
		decision.Reason = ReasonSnoozed
		return decision
	}
	if matchesApplication(c.denylist, app) {
		decision.Reason = ReasonDeniedApp
		return decision
	}
	if len(c.allowlist) > 0 && !matchesApplication(c.allowlist, app) {
		decision.Reason = ReasonAppNotAllowed
		return decision
	}
	decision.Allowed = true
	decision.Reason = ReasonAllowed
	return decision
}

func (c *Controller) Snapshot(now time.Time) Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	snoozed := now.Before(c.snoozedUntil)
	return Snapshot{
		Paused:       c.paused,
		SnoozedUntil: c.snoozedUntil,
		Monitoring:   !c.paused && !snoozed,
		AppAllowlist: append([]string(nil), c.allowlist...),
		AppDenylist:  append([]string(nil), c.denylist...),
	}
}

func normalizedCopy(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func matchesApplication(patterns []string, app Application) bool {
	bundleID := strings.ToLower(strings.TrimSpace(app.BundleID))
	name := strings.ToLower(strings.TrimSpace(app.Name))
	for _, pattern := range patterns {
		if pattern == bundleID || pattern == name {
			return true
		}
	}
	return false
}
