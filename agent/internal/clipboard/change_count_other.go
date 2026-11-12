//go:build !darwin || ios

package clipboard

// clipboard-ai is macOS-first. Returning -1 preserves payload polling on
// unsupported platforms used for static analysis or cross-platform tests.
func pasteboardChangeCount() int { return -1 }

// pasteboardTypes is unavailable off macOS.
func pasteboardTypes() []string { return nil }
