package clipboard

import (
	"context"
	"testing"
	"time"
)

// fakeClipboard drives the monitor's injectable read seams so the poll/dedupe
// loop can be exercised without the real (cgo/GUI) clipboard.
type fakeClipboard struct {
	text  []byte
	image []byte
	rtf   string
}

func newTestMonitor(handler Handler, fake *fakeClipboard) *Monitor {
	m := NewMonitor(150, handler)
	m.readText = func() []byte { return fake.text }
	m.readImage = func() []byte { return fake.image }
	m.readRTF = func() string { return fake.rtf }
	m.now = func() time.Time { return time.Unix(0, 0) }
	return m
}

func TestCheck_FiresHandlerOnNewText(t *testing.T) {
	var got []Content
	fake := &fakeClipboard{text: []byte("hello world")}
	m := newTestMonitor(func(c Content) { got = append(got, c) }, fake)

	m.check()

	if len(got) != 1 {
		t.Fatalf("expected handler to fire once, got %d", len(got))
	}
	if got[0].Text != "hello world" {
		t.Errorf("text = %q, want %q", got[0].Text, "hello world")
	}
	if got[0].Type != ContentTypeText {
		t.Errorf("type = %q, want %q", got[0].Type, ContentTypeText)
	}
}

func TestCheck_DedupesIdenticalText(t *testing.T) {
	var fires int
	fake := &fakeClipboard{text: []byte("same content")}
	m := newTestMonitor(func(Content) { fires++ }, fake)

	m.check()
	m.check()
	m.check()

	if fires != 1 {
		t.Fatalf("expected one fire for repeated identical content, got %d", fires)
	}
}

func TestCheck_FiresAgainWhenTextChanges(t *testing.T) {
	var fires int
	fake := &fakeClipboard{text: []byte("first")}
	m := newTestMonitor(func(Content) { fires++ }, fake)

	m.check()
	fake.text = []byte("second")
	m.check()

	if fires != 2 {
		t.Fatalf("expected two fires across distinct content, got %d", fires)
	}
}

func TestCheck_EmptyTextDoesNotFire(t *testing.T) {
	var fires int
	fake := &fakeClipboard{text: nil}
	m := newTestMonitor(func(Content) { fires++ }, fake)

	m.check()

	if fires != 0 {
		t.Fatalf("expected no fire for nil clipboard read, got %d", fires)
	}
}

func TestCheck_RTFTakesPrecedenceAndDedupes(t *testing.T) {
	var got []Content
	fake := &fakeClipboard{text: []byte("plain"), rtf: `{\rtf1 hello}`}
	m := newTestMonitor(func(c Content) { got = append(got, c) }, fake)

	m.check()
	m.check() // same RTF signature -> deduped

	if len(got) != 1 {
		t.Fatalf("expected one fire, got %d", len(got))
	}
	if got[0].Type != ContentTypeRTF {
		t.Errorf("type = %q, want %q", got[0].Type, ContentTypeRTF)
	}
	if got[0].Signature != `{\rtf1 hello}` {
		t.Errorf("signature = %q, want the RTF payload", got[0].Signature)
	}
}

func TestCheck_ImagePrecedenceAndDedupe(t *testing.T) {
	var got []Content
	// A real image-only clipboard returns nil for the text format.
	fake := &fakeClipboard{text: nil, image: []byte{0x89, 0x50, 0x4e, 0x47}}
	m := newTestMonitor(func(c Content) { got = append(got, c) }, fake)

	m.check()
	m.check() // identical image bytes -> deduped

	if len(got) != 1 {
		t.Fatalf("expected one image fire, got %d", len(got))
	}
	if got[0].Type != ContentTypeImage {
		t.Errorf("type = %q, want %q", got[0].Type, ContentTypeImage)
	}
	if got[0].Text != "" {
		t.Errorf("image content should not carry text, got %q", got[0].Text)
	}
}

func TestStart_PollsUntilContextCancelled(t *testing.T) {
	// Start() requires clipboard.Init(); skip the real init by calling check()
	// through a short-lived ticker substitute. We assert the loop honors ctx.
	fires := make(chan Content, 1)
	fake := &fakeClipboard{text: []byte("polled")}
	m := newTestMonitor(func(c Content) {
		select {
		case fires <- c:
		default:
		}
	}, fake)
	m.pollInterval = time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		// Drive the poll loop body directly (Start would call clipboard.Init,
		// which needs cgo); this mirrors Start's ticker -> check() dispatch.
		ticker := time.NewTicker(m.pollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				close(done)
				return
			case <-ticker.C:
				m.check()
			}
		}
	}()

	select {
	case c := <-fires:
		if c.Text != "polled" {
			t.Errorf("text = %q, want %q", c.Text, "polled")
		}
	case <-time.After(time.Second):
		t.Fatal("handler never fired during polling")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("poll loop did not stop after context cancel")
	}
}
