import AppKit
import SwiftUI

@main
struct ClipboardAIMenuBarApp: App {
    init() {
        NSApplication.shared.setActivationPolicy(.accessory)
    }

    var body: some Scene {
        MenuBarExtra("Clipboard AI", systemImage: "doc.on.clipboard") {
            VStack(alignment: .leading, spacing: 8) {
                Label("Clipboard AI", systemImage: "sparkles")
                    .font(.headline)
                Text("Native client ready")
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            .frame(width: 280)
        }
        .menuBarExtraStyle(.window)
    }
}
