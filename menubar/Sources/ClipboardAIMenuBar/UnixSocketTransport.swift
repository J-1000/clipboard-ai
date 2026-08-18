import Darwin
import Foundation

struct AgentHTTPRequest: Equatable, Sendable {
    let method: String
    let path: String
    let body: Data?

    init(method: String, path: String, body: Data? = nil) {
        self.method = method
        self.path = path
        self.body = body
    }
}

struct AgentHTTPResponse: Equatable, Sendable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data
}

protocol AgentTransport: Sendable {
    func send(_ request: AgentHTTPRequest) async throws -> AgentHTTPResponse
}

struct UnixSocketTransport: AgentTransport, Sendable {
    static let defaultSocketPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".clipboard-ai/agent.sock").path

    let socketPath: String
    let timeoutSeconds: Int
    let maxResponseBytes: Int

    init(
        socketPath: String = UnixSocketTransport.defaultSocketPath,
        timeoutSeconds: Int = 15,
        maxResponseBytes: Int = 12 * 1_024 * 1_024
    ) {
        self.socketPath = socketPath
        self.timeoutSeconds = timeoutSeconds
        self.maxResponseBytes = maxResponseBytes
    }

    func send(_ request: AgentHTTPRequest) async throws -> AgentHTTPResponse {
        let socketPath = socketPath
        let timeoutSeconds = timeoutSeconds
        let maxResponseBytes = maxResponseBytes
        return try await Task.detached(priority: .userInitiated) {
            try UnixHTTPConnection(
                socketPath: socketPath,
                timeoutSeconds: timeoutSeconds,
                maxResponseBytes: maxResponseBytes
            ).send(request)
        }.value
    }
}

private struct UnixHTTPConnection {
    let socketPath: String
    let timeoutSeconds: Int
    let maxResponseBytes: Int

    func send(_ request: AgentHTTPRequest) throws -> AgentHTTPResponse {
        guard request.method == "GET" || request.method == "POST" else {
            throw AgentAPIError.invalidRequest("Unsupported method \(request.method)")
        }
        guard request.path.hasPrefix("/") && !request.path.contains("\r") && !request.path.contains("\n") else {
            throw AgentAPIError.invalidRequest("Invalid request path")
        }

        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw posixError("Could not create local socket")
        }
        defer { Darwin.close(descriptor) }

        try configure(descriptor)
        try connect(descriptor)
        try writeAll(makeRequestData(request), to: descriptor)
        return try readResponse(from: descriptor)
    }

    private func configure(_ descriptor: Int32) throws {
        var noSignal: Int32 = 1
        guard setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_NOSIGPIPE,
            &noSignal,
            socklen_t(MemoryLayout.size(ofValue: noSignal))
        ) == 0 else {
            throw posixError("Could not configure local socket")
        }

        var timeout = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
        let timeoutSize = socklen_t(MemoryLayout.size(ofValue: timeout))
        guard setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, timeoutSize) == 0,
              setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, timeoutSize) == 0
        else {
            throw posixError("Could not set local socket timeout")
        }
    }

    private func connect(_ descriptor: Int32) throws {
        let pathBytes = Array(socketPath.utf8CString)
        var address = sockaddr_un()
        let pathCapacity = MemoryLayout.size(ofValue: address.sun_path)
        guard pathBytes.count <= pathCapacity else {
            throw AgentAPIError.invalidRequest("Agent socket path is too long")
        }

        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        _ = socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path.0) { destination in
                strlcpy(destination, source, pathCapacity)
            }
        }

        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            throw posixError("Could not connect to clipboard-ai-agent")
        }
    }

    private func makeRequestData(_ request: AgentHTTPRequest) -> Data {
        let body = request.body ?? Data()
        var headers = [
            "\(request.method) \(request.path) HTTP/1.1",
            "Host: localhost",
            "Accept: application/json",
            "Connection: close",
        ]
        if request.body != nil {
            headers.append("Content-Type: application/json")
            headers.append("Content-Length: \(body.count)")
        }
        var data = Data((headers.joined(separator: "\r\n") + "\r\n\r\n").utf8)
        data.append(body)
        return data
    }

    private func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var written = 0
            while written < data.count {
                let result = Darwin.write(
                    descriptor,
                    baseAddress.advanced(by: written),
                    data.count - written
                )
                if result < 0 {
                    if errno == EINTR { continue }
                    throw posixError("Could not send request to clipboard-ai-agent")
                }
                written += result
            }
        }
    }

    private func readResponse(from descriptor: Int32) throws -> AgentHTTPResponse {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1_024)

        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw posixError("Could not read response from clipboard-ai-agent")
            }
            data.append(buffer, count: count)
            if data.count > maxResponseBytes {
                throw AgentAPIError.responseTooLarge
            }
        }

        return try HTTPResponseParser.parse(data)
    }

    private func posixError(_ prefix: String) -> AgentAPIError {
        AgentAPIError.connection("\(prefix): \(String(cString: strerror(errno)))")
    }
}

enum HTTPResponseParser {
    private static let headerSeparator = Data("\r\n\r\n".utf8)
    private static let lineSeparator = Data("\r\n".utf8)

    static func parse(_ data: Data) throws -> AgentHTTPResponse {
        guard let separator = data.range(of: headerSeparator) else {
            throw AgentAPIError.invalidResponse("Missing HTTP headers")
        }
        guard let headerText = String(data: data[..<separator.lowerBound], encoding: .utf8) else {
            throw AgentAPIError.invalidResponse("Headers were not UTF-8")
        }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let statusLine = lines.first else {
            throw AgentAPIError.invalidResponse("Missing HTTP status")
        }
        let statusParts = statusLine.split(separator: " ", maxSplits: 2)
        guard statusParts.count >= 2, let statusCode = Int(statusParts[1]) else {
            throw AgentAPIError.invalidResponse("Invalid HTTP status")
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }

        let rawBody = Data(data[separator.upperBound...])
        let body: Data
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
            body = try decodeChunked(rawBody)
        } else if let value = headers["content-length"], let length = Int(value) {
            guard rawBody.count >= length else {
                throw AgentAPIError.invalidResponse("Truncated HTTP body")
            }
            body = Data(rawBody.prefix(length))
        } else {
            body = rawBody
        }

        return AgentHTTPResponse(statusCode: statusCode, headers: headers, body: body)
    }

    private static func decodeChunked(_ data: Data) throws -> Data {
        var cursor = data.startIndex
        var decoded = Data()

        while true {
            guard let lineEnd = data[cursor...].range(of: lineSeparator) else {
                throw AgentAPIError.invalidResponse("Invalid chunk header")
            }
            guard let sizeLine = String(data: data[cursor..<lineEnd.lowerBound], encoding: .utf8) else {
                throw AgentAPIError.invalidResponse("Invalid chunk size")
            }
            let sizeText = sizeLine.split(separator: ";", maxSplits: 1)[0]
            guard let size = Int(sizeText, radix: 16), size >= 0 else {
                throw AgentAPIError.invalidResponse("Invalid chunk size")
            }
            cursor = lineEnd.upperBound
            if size == 0 { return decoded }

            guard size <= data.distance(from: cursor, to: data.endIndex) else {
                throw AgentAPIError.invalidResponse("Truncated chunk")
            }
            let chunkEnd = data.index(cursor, offsetBy: size)
            decoded.append(data[cursor..<chunkEnd])
            guard data.distance(from: chunkEnd, to: data.endIndex) >= lineSeparator.count,
                  data[chunkEnd..<data.index(chunkEnd, offsetBy: lineSeparator.count)] == lineSeparator
            else {
                throw AgentAPIError.invalidResponse("Invalid chunk terminator")
            }
            cursor = data.index(chunkEnd, offsetBy: lineSeparator.count)
        }
    }
}
