import Foundation

protocol AgentServing: Sendable {
    func status() async throws -> AgentStatus
    func history(limit: Int) async throws -> HistoryResponse
    func configuration() async throws -> AgentConfiguration
    func controls() async throws -> MonitoringControls
    func setControl(_ action: MonitoringAction) async throws -> MonitoringControls
    func runAction(_ request: ActionRequest) async throws -> ActionResponse
}

enum MonitoringAction: Equatable, Sendable {
    case pause
    case resume
    case snooze(minutes: Int?)

    var request: ControlRequest {
        switch self {
        case .pause:
            ControlRequest(action: "pause", durationMinutes: nil)
        case .resume:
            ControlRequest(action: "resume", durationMinutes: nil)
        case let .snooze(minutes):
            ControlRequest(action: "snooze", durationMinutes: minutes)
        }
    }
}

struct AgentAPI: AgentServing, Sendable {
    /// `/action` waits for a model call, so it must outlast the agent's own
    /// action timeout (30 seconds by default, or `actions.<name>.timeout_ms`).
    static let actionTimeoutSeconds = 120

    private let transport: any AgentTransport
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(transport: any AgentTransport = UnixSocketTransport()) {
        self.transport = transport

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        self.encoder = encoder
    }

    func status() async throws -> AgentStatus {
        try await get("/status", as: AgentStatus.self)
    }

    func history(limit: Int = 50) async throws -> HistoryResponse {
        let boundedLimit = min(max(limit, 0), 100)
        return try await get("/history?limit=\(boundedLimit)", as: HistoryResponse.self)
    }

    func configuration() async throws -> AgentConfiguration {
        try await get("/config", as: AgentConfiguration.self)
    }

    func controls() async throws -> MonitoringControls {
        try await get("/controls", as: MonitoringControls.self)
    }

    func setControl(_ action: MonitoringAction) async throws -> MonitoringControls {
        try await post("/controls", body: action.request, as: MonitoringControls.self)
    }

    func runAction(_ request: ActionRequest) async throws -> ActionResponse {
        try await post(
            "/action",
            body: request,
            as: ActionResponse.self,
            timeoutSeconds: Self.actionTimeoutSeconds
        )
    }

    private func get<Response: Decodable & Sendable>(
        _ path: String,
        as type: Response.Type
    ) async throws -> Response {
        let response = try await transport.send(AgentHTTPRequest(method: "GET", path: path))
        return try decode(response, as: type)
    }

    private func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ path: String,
        body: Body,
        as type: Response.Type,
        timeoutSeconds: Int? = nil
    ) async throws -> Response {
        let payload = try encoder.encode(body)
        let response = try await transport.send(
            AgentHTTPRequest(method: "POST", path: path, body: payload, timeoutSeconds: timeoutSeconds)
        )
        return try decode(response, as: type)
    }

    private func decode<Response: Decodable & Sendable>(
        _ response: AgentHTTPResponse,
        as type: Response.Type
    ) throws -> Response {
        guard (200 ..< 300).contains(response.statusCode) else {
            let message = (try? decoder.decode(APIErrorBody.self, from: response.body).error)
                ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
            throw AgentAPIError.httpStatus(response.statusCode, message)
        }
        do {
            return try decoder.decode(type, from: response.body)
        } catch {
            throw AgentAPIError.invalidJSON(error.localizedDescription)
        }
    }
}

private struct APIErrorBody: Decodable {
    let error: String
}

enum AgentAPIError: LocalizedError, Equatable {
    case invalidRequest(String)
    case connection(String)
    case invalidResponse(String)
    case responseTooLarge
    case httpStatus(Int, String)
    case invalidJSON(String)

    var errorDescription: String? {
        switch self {
        case let .invalidRequest(message), let .connection(message), let .invalidResponse(message):
            message
        case .responseTooLarge:
            "The agent response exceeded the local client limit."
        case let .httpStatus(code, message):
            "Agent request failed (\(code)): \(message)"
        case let .invalidJSON(message):
            "The agent returned invalid data: \(message)"
        }
    }
}
