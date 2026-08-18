package automation

import (
	"context"
	"testing"
	"time"
)

func TestConcurrencyGate_SetLimitExpandsCapacity(t *testing.T) {
	gate := NewConcurrencyGate(1)
	releaseFirst, ok := gate.Acquire(context.Background())
	if !ok {
		t.Fatal("first acquisition should succeed")
	}
	defer releaseFirst()

	acquired := make(chan func(), 1)
	started := make(chan struct{})
	go func() {
		close(started)
		release, ok := gate.Acquire(context.Background())
		if ok {
			acquired <- release
		}
	}()
	<-started

	select {
	case release := <-acquired:
		release()
		t.Fatal("second acquisition should wait at limit one")
	default:
	}

	gate.SetLimit(2)
	select {
	case release := <-acquired:
		release()
	case <-time.After(time.Second):
		t.Fatal("expanded hot-reload limit did not unblock acquisition")
	}
}

func TestConcurrencyGate_SetLimitShrinksWithoutCancellingActiveWork(t *testing.T) {
	gate := NewConcurrencyGate(2)
	releaseFirst, _ := gate.Acquire(context.Background())
	releaseSecond, _ := gate.Acquire(context.Background())
	gate.SetLimit(1)

	acquired := make(chan func(), 1)
	go func() {
		release, ok := gate.Acquire(context.Background())
		if ok {
			acquired <- release
		}
	}()

	releaseFirst()
	select {
	case release := <-acquired:
		release()
		t.Fatal("new work started while active count still equaled shrunken limit")
	case <-time.After(20 * time.Millisecond):
	}

	releaseSecond()
	select {
	case release := <-acquired:
		release()
	case <-time.After(time.Second):
		t.Fatal("work did not start after active count fell below shrunken limit")
	}
}

func TestConcurrencyGate_ZeroLimitAndCancellation(t *testing.T) {
	gate := NewConcurrencyGate(1)
	release, _ := gate.Acquire(context.Background())
	defer release()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := gate.Acquire(ctx); ok {
		t.Fatal("full gate should honor context cancellation")
	}

	gate.SetLimit(0)
	releaseUnlimited, ok := gate.Acquire(context.Background())
	if !ok {
		t.Fatal("zero hot-reload limit should allow unlimited work")
	}
	releaseUnlimited()
}
