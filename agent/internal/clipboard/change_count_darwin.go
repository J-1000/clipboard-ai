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
	typesSelector             = objc.RegisterName("types")
	countSelector             = objc.RegisterName("count")
	objectAtIndexSelector     = objc.RegisterName("objectAtIndex:")
	utf8StringSelector        = objc.RegisterName("UTF8String")
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

// pasteboardTypes returns the type identifiers currently declared on the
// general pasteboard without reading any payload.
func pasteboardTypes() []string {
	runtime.LockOSThread()
	pool := objc.ID(nsAutoreleasePoolClass).Send(allocSelector).Send(initSelector)
	defer func() {
		pool.Send(drainSelector)
		runtime.UnlockOSThread()
	}()

	pasteboard := objc.ID(nsPasteboardClass).Send(generalPasteboardSelector)
	types := pasteboard.Send(typesSelector)
	if types == 0 {
		return nil
	}
	count := int(types.Send(countSelector))
	names := make([]string, 0, count)
	for i := 0; i < count; i++ {
		item := types.Send(objectAtIndexSelector, i)
		if item == 0 {
			continue
		}
		names = append(names, objc.Send[string](item, utf8StringSelector))
	}
	return names
}
