import Darwin
import Foundation
import XCTest
@testable import ClipboardAIMenuBar

final class UnixSocketTransportTests: XCTestCase, @unchecked Sendable {
    func testParsesContentLengthResponse() throws {
        let response = try HTTPResponseParser.parse(
            Data("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nX-API-Version: 1\r\n\r\nhello".utf8)
        )

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["x-api-version"], "1")
        XCTAssertEqual(String(data: response.body, encoding: .utf8), "hello")
    }

    func testParsesChunkedResponse() throws {
        let response = try HTTPResponseParser.parse(
            Data(
                "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".utf8
                    + Data("4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n".utf8)
            )
        )

        XCTAssertEqual(String(data: response.body, encoding: .utf8), "Wikipedia")
    }

    func testRejectsTruncatedContentLengthResponse() {
        XCTAssertThrowsError(
            try HTTPResponseParser.parse(
                Data("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort".utf8)
            )
        ) { error in
            XCTAssertEqual(error as? AgentAPIError, .invalidResponse("Truncated HTTP body"))
        }
    }

    func testPerformsARealUnixSocketRoundTrip() async throws {
        let socketPath = "/tmp/cbai-\(ProcessInfo.processInfo.processIdentifier)-\(UUID().uuidString).sock"
        let server = try UnixTestServer(
            socketPath: socketPath,
            response: Data(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n".utf8
                    + Data("Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n".utf8)
                    + Data("B\r\n{\"ok\":true}\r\n0\r\n\r\n".utf8)
            )
        )
        server.start()

        let response = try await UnixSocketTransport(socketPath: socketPath).send(
            AgentHTTPRequest(method: "GET", path: "/status")
        )

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(String(data: response.body, encoding: .utf8), "{\"ok\":true}")
        XCTAssertTrue(server.receivedRequest.contains("GET /status HTTP/1.1"))
    }
}

private final class UnixTestServer: @unchecked Sendable {
    private let descriptor: Int32
    private let socketPath: String
    private let response: Data
    private let requestLock = NSLock()
    private var requestText = ""

    var receivedRequest: String {
        requestLock.withLock { requestText }
    }

    init(socketPath: String, response: Data) throws {
        self.socketPath = socketPath
        self.response = response
        descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw AgentAPIError.connection("test socket creation failed")
        }

        Darwin.unlink(socketPath)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let pathCapacity = MemoryLayout.size(ofValue: address.sun_path)
        guard socketPath.utf8CString.count <= pathCapacity else {
            Darwin.close(descriptor)
            throw AgentAPIError.invalidRequest("test socket path too long")
        }
        _ = socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path.0) { destination in
                strlcpy(destination, source, pathCapacity)
            }
        }

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0, Darwin.listen(descriptor, 1) == 0 else {
            Darwin.close(descriptor)
            throw AgentAPIError.connection("test socket bind failed")
        }
    }

    deinit {
        Darwin.close(descriptor)
        Darwin.unlink(socketPath)
    }

    func start() {
        let descriptor = descriptor
        let response = response
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let client = Darwin.accept(descriptor, nil, nil)
            guard client >= 0 else { return }
            defer { Darwin.close(client) }

            var buffer = [UInt8](repeating: 0, count: 4_096)
            let count = Darwin.read(client, &buffer, buffer.count)
            if count > 0 {
                let request = String(decoding: buffer.prefix(count), as: UTF8.self)
                self?.requestLock.withLock {
                    self?.requestText = request
                }
            }

            response.withUnsafeBytes { bytes in
                guard let baseAddress = bytes.baseAddress else { return }
                var written = 0
                while written < response.count {
                    let count = Darwin.write(
                        client,
                        baseAddress.advanced(by: written),
                        response.count - written
                    )
                    if count <= 0 { return }
                    written += count
                }
            }
        }
    }
}
