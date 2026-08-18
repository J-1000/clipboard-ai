package privacy

import (
	"testing"
	"time"
)

func TestControllerPauseSnoozeAndResume(t *testing.T) {
	now := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	controller := NewController(false, nil, nil)
	app := Application{Name: "Notes", BundleID: "com.apple.Notes"}

	if decision := controller.Decision(app, now); !decision.Allowed {
		t.Fatalf("initial decision = %#v, want allowed", decision)
	}
	controller.Pause()
	if decision := controller.Decision(app, now); decision.Allowed || decision.Reason != ReasonPaused {
		t.Fatalf("paused decision = %#v", decision)
	}

	controller.Resume()
	controller.Snooze(15*time.Minute, now)
	if decision := controller.Decision(app, now.Add(14*time.Minute)); decision.Allowed || decision.Reason != ReasonSnoozed {
		t.Fatalf("snoozed decision = %#v", decision)
	}
	if decision := controller.Decision(app, now.Add(15*time.Minute)); !decision.Allowed {
		t.Fatalf("expired snooze decision = %#v, want allowed", decision)
	}

	controller.Resume()
	snapshot := controller.Snapshot(now)
	if !snapshot.Monitoring || snapshot.Paused || !snapshot.SnoozedUntil.IsZero() {
		t.Fatalf("resumed snapshot = %#v", snapshot)
	}
}

func TestControllerApplicationPolicies(t *testing.T) {
	now := time.Now()
	controller := NewController(false, []string{"com.apple.notes", "Preview"}, []string{"com.example.private"})

	tests := []struct {
		name   string
		app    Application
		allow  bool
		reason string
	}{
		{name: "bundle allow", app: Application{BundleID: "COM.APPLE.NOTES"}, allow: true, reason: ReasonAllowed},
		{name: "name allow", app: Application{Name: "preview"}, allow: true, reason: ReasonAllowed},
		{name: "deny", app: Application{BundleID: "com.example.private"}, allow: false, reason: ReasonDeniedApp},
		{name: "not allowlisted", app: Application{Name: "Mail", BundleID: "com.apple.mail"}, allow: false, reason: ReasonAppNotAllowed},
		{name: "unknown secure default", app: Application{}, allow: false, reason: ReasonAppNotAllowed},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			decision := controller.Decision(tc.app, now)
			if decision.Allowed != tc.allow || decision.Reason != tc.reason {
				t.Fatalf("decision = %#v, want allowed=%v reason=%q", decision, tc.allow, tc.reason)
			}
		})
	}

	controller.UpdatePolicy(nil, []string{"Mail"})
	if decision := controller.Decision(Application{Name: "Notes"}, now); !decision.Allowed {
		t.Fatalf("hot-reloaded empty allowlist should allow Notes: %#v", decision)
	}
	if decision := controller.Decision(Application{Name: "MAIL"}, now); decision.Allowed {
		t.Fatalf("hot-reloaded denylist should block Mail: %#v", decision)
	}
}
