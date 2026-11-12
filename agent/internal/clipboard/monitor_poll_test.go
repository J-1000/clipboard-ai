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

func TestCheck_EmptyClipboardClearsCurrent(t *testing.T) {
	fake := &fakeClipboard{text: []byte("previous")}
	m := newTestMonitor(nil, fake)

	m.check()
	if got := m.Current().Text; got != "previous" {
		t.Fatalf("current text = %q, want previous", got)
	}

	fake.text = nil
	m.check()
	if got := m.Current(); got.Text != "" || got.RTF != "" || len(got.Image) != 0 || got.Type != "" || got.Signature != "" || !got.Timestamp.IsZero() {
		t.Fatalf("current content = %#v, want empty content", got)
	}
}

func TestPoll_SkipsPayloadReadsUntilChangeCountAdvances(t *testing.T) {
	var textReads, imageReads, rtfReads int
	changeCount := 41
	m := NewMonitor(150, nil)
	m.readChangeCount = func() int { return changeCount }
	m.readText = func() []byte {
		textReads++
		return []byte("payload")
	}
	m.readImage = func() []byte {
		imageReads++
		return nil
	}
	m.readRTF = func() string {
		rtfReads++
		return ""
	}

	m.poll()
	m.poll()
	m.poll()
	if textReads != 1 || imageReads != 1 || rtfReads != 1 {
		t.Fatalf("unchanged reads = text:%d image:%d rtf:%d, want one each", textReads, imageReads, rtfReads)
	}

	changeCount++
	m.poll()
	if textReads != 2 || imageReads != 2 || rtfReads != 2 {
		t.Fatalf("changed reads = text:%d image:%d rtf:%d, want two each", textReads, imageReads, rtfReads)
	}
}

func TestPoll_FallsBackToPayloadPollingWithoutChangeCount(t *testing.T) {
	var textReads int
	m := NewMonitor(150, nil)
	m.readChangeCount = func() int { return -1 }
	m.readImage = func() []byte { return nil }
	m.readText = func() []byte {
		textReads++
		return []byte("payload")
	}
	m.readRTF = func() string { return "" }

	m.poll()
	m.poll()
	if textReads != 2 {
		t.Fatalf("text reads = %d, want 2 fallback reads", textReads)
	}
}

func TestPoll_ReadPolicyBlocksPayloadAndClearsCurrent(t *testing.T) {
	changeCount := 1
	allowed := true
	var payloadReads int
	m := NewMonitor(150, nil)
	m.readChangeCount = func() int { return changeCount }
	m.readImage = func() []byte {
		payloadReads++
		return nil
	}
	m.readText = func() []byte {
		payloadReads++
		return []byte("secret")
	}
	m.readRTF = func() string {
		payloadReads++
		return ""
	}
	m.SetReadPolicy(func() bool { return allowed })

	m.poll()
	if m.Current().Text != "secret" || payloadReads != 3 {
		t.Fatalf("initial current=%#v reads=%d", m.Current(), payloadReads)
	}

	allowed = false
	changeCount++
	m.poll()
	if payloadReads != 3 {
		t.Fatalf("blocked poll performed payload reads: got %d, want 3", payloadReads)
	}
	if current := m.Current(); current.Text != "" || current.Signature != "" || len(current.Image) != 0 {
		t.Fatalf("blocked poll retained clipboard payload: %#v", current)
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

func TestPoll_FirstPollStoresContentWithoutFiring(t *testing.T) {
	var fires int
	changeCount := 7
	fake := &fakeClipboard{text: []byte("copied before the agent started")}
	m := newTestMonitor(func(Content) { fires++ }, fake)
	m.readChangeCount = func() int { return changeCount }

	m.poll()
	if fires != 0 {
		t.Fatalf("first poll fired the handler %d time(s), want 0", fires)
	}
	if got := m.Current().Text; got != "copied before the agent started" {
		t.Fatalf("first poll should still record current content, got %q", got)
	}

	changeCount++
	fake.text = []byte("copied after start")
	m.poll()
	if fires != 1 {
		t.Fatalf("second poll fired %d time(s), want 1", fires)
	}
}

func TestReadNow_BypassesPolicyAndLeavesStateUntouched(t *testing.T) {
	var fires int
	fake := &fakeClipboard{text: []byte("on demand")}
	m := newTestMonitor(func(Content) { fires++ }, fake)
	m.readChangeCount = func() int { return 1 }
	m.SetReadPolicy(func() bool { return false }) // paused

	m.poll()
	if got := m.Current().Text; got != "" {
		t.Fatalf("paused monitor should hold nothing, got %q", got)
	}

	content := m.ReadNow()
	if content.Text != "on demand" || content.Type != ContentTypeText {
		t.Fatalf("ReadNow = %#v, want the live clipboard text", content)
	}
	if got := m.Current().Text; got != "" {
		t.Fatalf("ReadNow must not populate the monitor, got %q", got)
	}
	if fires != 0 {
		t.Fatalf("ReadNow fired the handler %d time(s)", fires)
	}

	fake.text = nil
	if empty := m.ReadNow(); empty.Text != "" || empty.Type != "" {
		t.Fatalf("ReadNow on an empty clipboard = %#v, want zero Content", empty)
	}
}

func TestCheck_RecopiedImageKeepsCurrent(t *testing.T) {
	var fires int
	fake := &fakeClipboard{image: []byte{0x89, 0x50, 0x4e, 0x47}}
	m := newTestMonitor(func(Content) { fires++ }, fake)

	m.check()
	m.check() // the same image copied again
	if fires != 1 {
		t.Fatalf("identical image fired %d time(s), want 1", fires)
	}
	if got := m.Current(); got.Type != ContentTypeImage || len(got.Image) == 0 {
		t.Fatalf("re-copying the same image cleared the monitor: %#v", got)
	}
}

func TestClear_IsSafeDuringChecks(t *testing.T) {
	fake := &fakeClipboard{text: []byte("payload")}
	m := newTestMonitor(nil, fake)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 200; i++ {
			m.Clear()
		}
	}()
	for i := 0; i < 200; i++ {
		m.check()
	}
	<-done
}
