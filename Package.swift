// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DustLlmCapacitor",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(
            name: "DustLlmCapacitor",
            targets: ["LLMPlugin"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/rogelioRuiz/dust-core-swift.git", from: "0.1.2"),
        .package(url: "https://github.com/rogelioRuiz/dust-llm-swift.git", branch: "main"),
    ],
    targets: [
        .target(
            name: "LLMPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "DustCore", package: "dust-core-swift"),
                .product(name: "DustLlm", package: "dust-llm-swift"),
            ],
            path: "ios/Sources/LLMPlugin"
        ),
    ]
)
