import AppKit
import SwiftUI

@main
struct ClipboardAIMenuBarApp: App {
    @StateObject private var store: MenuBarStore

    init() {
        NSApplication.shared.setActivationPolicy(.accessory)
        _store = StateObject(wrappedValue: MenuBarStore())
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarRootView(store: store)
        } label: {
            Label("Clipboard AI", systemImage: menuBarSymbol)
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarSymbol: String {
        if store.runningActionID != nil {
            return "bolt.horizontal.circle"
        }
        if store.monitoring?.monitoring == false {
            return "pause.circle"
        }
        return "doc.on.clipboard"
    }
}
