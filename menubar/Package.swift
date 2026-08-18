// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ClipboardAIMenuBar",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ClipboardAIMenuBar", targets: ["ClipboardAIMenuBar"]),
    ],
    targets: [
        .executableTarget(name: "ClipboardAIMenuBar"),
        .testTarget(
            name: "ClipboardAIMenuBarTests",
            dependencies: ["ClipboardAIMenuBar"]
        ),
    ]
)
