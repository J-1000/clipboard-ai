//go:build darwin && !ios

package privacy

import (
	"runtime"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

var (
	privacyAppKit = openAppKit()

	workspaceClass       = objc.GetClass("NSWorkspace")
	autoreleasePoolClass = objc.GetClass("NSAutoreleasePool")
	sharedWorkspaceSel   = objc.RegisterName("sharedWorkspace")
	frontmostAppSel      = objc.RegisterName("frontmostApplication")
	bundleIdentifierSel  = objc.RegisterName("bundleIdentifier")
	localizedNameSel     = objc.RegisterName("localizedName")
	utf8StringSel        = objc.RegisterName("UTF8String")
	allocSel             = objc.RegisterName("alloc")
	initSel              = objc.RegisterName("init")
	drainSel             = objc.RegisterName("drain")
)

func openAppKit() uintptr {
	handle, err := purego.Dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", purego.RTLD_GLOBAL|purego.RTLD_NOW)
	if err != nil {
		panic(err)
	}
	return handle
}

// FrontmostApplication reads NSWorkspace.frontmostApplication without asking
// for Accessibility or Apple Events permission.
func FrontmostApplication() Application {
	runtime.KeepAlive(privacyAppKit)
	runtime.LockOSThread()
	pool := objc.ID(autoreleasePoolClass).Send(allocSel).Send(initSel)
	defer func() {
		pool.Send(drainSel)
		runtime.UnlockOSThread()
	}()

	workspace := objc.ID(workspaceClass).Send(sharedWorkspaceSel)
	app := workspace.Send(frontmostAppSel)
	if app == 0 {
		return Application{}
	}
	return Application{
		Name:     goString(objc.ID(app).Send(localizedNameSel)),
		BundleID: goString(objc.ID(app).Send(bundleIdentifierSel)),
	}
}

func goString(value objc.ID) string {
	if value == 0 {
		return ""
	}
	// objc.Send[string] copies the returned C string into a Go string.
	return objc.Send[string](value, utf8StringSel)
}
