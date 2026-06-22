package guard

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Shared with cli/src/lib/sensitive-guard.test.ts. Both suites consume
// testdata/sensitive-guard-cases.json so Go/TS guard drift fails CI.
type parityCase struct {
	Name     string   `json:"name"`
	Input    string   `json:"input"`
	Expected []string `json:"expected"`
}

func loadParityCases(t *testing.T) []parityCase {
	t.Helper()
	path := filepath.Join("..", "..", "..", "testdata", "sensitive-guard-cases.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read parity fixture: %v", err)
	}
	var cases []parityCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse parity fixture: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("parity fixture is empty")
	}
	return cases
}

func TestGuardParityFixture(t *testing.T) {
	for _, tc := range loadParityCases(t) {
		t.Run(tc.Name, func(t *testing.T) {
			seen := map[string]struct{}{}
			for _, f := range Scan(tc.Input) {
				seen[f.Type] = struct{}{}
			}
			got := make([]string, 0, len(seen))
			for typ := range seen {
				got = append(got, typ)
			}
			sort.Strings(got)
			want := append([]string(nil), tc.Expected...)
			sort.Strings(want)

			if len(got) != len(want) {
				t.Fatalf("input %q: got types %v, want %v", tc.Input, got, want)
			}
			for i := range got {
				if got[i] != want[i] {
					t.Fatalf("input %q: got types %v, want %v", tc.Input, got, want)
				}
			}
		})
	}
}
