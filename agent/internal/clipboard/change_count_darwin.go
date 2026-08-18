//go:build darwin && !ios

package clipboard

import (
	"runtime"

	"github.com/ebitengine/purego/objc"
)

var (
	nsPasteboardClass         = objc.GetClass("NSPasteboard")
	nsAutoreleasePoolClass    = objc.GetClass("NSAutoreleasePool")
	generalPasteboardSelector = objc.RegisterName("generalPasteboard")
	changeCountSelector       = objc.RegisterName("changeCount")
	allocSelector             = objc.RegisterName("alloc")
	initSelector              = objc.RegisterName("init")
	drainSelector             = objc.RegisterName("drain")
)

// pasteboardChangeCount returns NSPasteboard.general.changeCount without
// reading any clipboard payload. AppKit accessors return autoreleased objects,
// so keep the pool and its drain on one OS thread.
func pasteboardChangeCount() int {
	runtime.LockOSThread()
	pool := objc.ID(nsAutoreleasePoolClass).Send(allocSelector).Send(initSelector)
	defer func() {
		pool.Send(drainSelector)
		runtime.UnlockOSThread()
	}()

	pasteboard := objc.ID(nsPasteboardClass).Send(generalPasteboardSelector)
	return int(pasteboard.Send(changeCountSelector))
}
