import Foundation
import XCTest
@testable import ClipboardAIMenuBar

@MainActor
final class AgentAPITests: XCTestCase {
    func testDecodesStatusAndMonitoringState() async throws {
        let transport = RecordingTransport(responses: [
            jsonResponse("""
            {
              "status": "running",
              "uptime": "2m3s",
              "version": "v0.2.0",
              "clipboard": {
                "text": "hello",
                "type": "text",
                "timestamp": "2026-08-18T12:00:00Z"
              },
              "monitoring": {
                "monitoring": false,
                "paused": false,
                "snoozed_until": "2026-08-18T12:15:00Z",
                "default_snooze_minutes": 15,
                "app_allowlist": [],
                "app_denylist": ["com.example.Secrets"]
              }
            }
            """),
        ])
        let api = AgentAPI(transport: transport)

        let status = try await api.status()

        XCTAssertEqual(status.clipboard.text, "hello")
        XCTAssertFalse(status.monitoring.monitoring)
        XCTAssertEqual(status.monitoring.snoozedUntil, "2026-08-18T12:15:00Z")
        let requests = await transport.requests()
        XCTAssertEqual(requests, [AgentHTTPRequest(method: "GET", path: "/status")])
    }

    func testClampsHistoryLimitAndDecodesProviderProfile() async throws {
        let transport = RecordingTransport(responses: [
            jsonResponse("""
            {
              "records": [{
                "id": "run-1",
                "timestamp": "2026-08-18T12:00:00.123Z",
                "action": "summary",
                "args": [],
                "source": "daemon",
                "trigger": "length > 200",
                "provider": "openai",
                "provider_profile": "work",
                "model": "gpt-5-mini",
                "latency_ms": 321,
                "status": "success",
                "copy": false,
                "input": "long article",
                "output": "short summary"
              }],
              "skipped_corrupt": 2
            }
            """),
        ])
        let api = AgentAPI(transport: transport)

        let history = try await api.history(limit: 500)

        XCTAssertEqual(history.skippedCorrupt, 2)
        XCTAssertEqual(history.records.first?.providerProfile, "work")
        XCTAssertEqual(history.records.first?.latencyMs, 321)
        XCTAssertNotNil(history.records.first?.timestampDate)
        let requests = await transport.requests()
        XCTAssertEqual(
            requests,
            [AgentHTTPRequest(method: "GET", path: "/history?limit=100")]
        )
    }

    func testDecodesNamedProviderConfiguration() async throws {
        let transport = RecordingTransport(responses: [
            jsonResponse("""
            {
              "provider": {
                "type": "ollama",
                "endpoint": "http://127.0.0.1:11434/v1",
                "model": "mistral"
              },
              "providers": {
                "work": {
                  "type": "openai",
                  "endpoint": "https://api.openai.com/v1",
                  "model": "gpt-5-mini",
                  "api_key": "<redacted>",
                  "daily_token_limit": 5000
                }
              },
              "actions": {
                "summary": {
                  "enabled": true,
                  "trigger": "length > 200",
                  "provider_profile": "work",
                  "fallback_profiles": ["default"]
                }
              },
              "settings": {
                "poll_interval": 150000000,
                "safe_mode": true,
                "notifications": true,
                "log_level": "info",
                "max_concurrent_actions": 3
              },
              "privacy": {
                "start_paused": false,
                "default_snooze_minutes": 15,
                "app_allowlist": [],
                "app_denylist": []
              }
            }
            """),
        ])

        let config = try await AgentAPI(transport: transport).configuration()

        XCTAssertEqual(config.providers?["work"]?.dailyTokenLimit, 5000)
        XCTAssertEqual(config.actions["summary"]?.providerProfile, "work")
        XCTAssertEqual(config.actions["summary"]?.fallbackProfiles, ["default"])
        XCTAssertEqual(config.settings.maxConcurrentActions, 3)
    }

    func testEncodesControlsAndActionRequestsWithSnakeCaseKeys() async throws {
        let transport = RecordingTransport(responses: [
            jsonResponse("""
            {
              "monitoring": false,
              "paused": false,
              "snoozed_until": "2026-08-18T12:30:00Z",
              "default_snooze_minutes": 15,
              "app_allowlist": [],
              "app_denylist": []
            }
            """),
            jsonResponse("""
            {"success": true, "action": "translate", "result": "Hallo"}
            """),
        ])
        let api = AgentAPI(transport: transport)

        _ = try await api.setControl(.snooze(minutes: 30))
        let result = try await api.runAction(
            ActionRequest(action: "translate", args: ["German"], text: "Hello", type: "text")
        )

        XCTAssertEqual(result.result, "Hallo")
        let requests = await transport.requests()
        XCTAssertEqual(requests.map(\.path), ["/controls", "/action"])
        XCTAssertEqual(try jsonObject(requests[0].body)["duration_minutes"] as? Int, 30)
        XCTAssertEqual(try jsonObject(requests[1].body)["action"] as? String, "translate")
        XCTAssertEqual(try jsonObject(requests[1].body)["args"] as? [String], ["German"])
        // /controls keeps the short default; /action gets the long timeout.
        XCTAssertNil(requests[0].timeoutSeconds)
        XCTAssertNil(try jsonObject(requests[1].body)["fresh"])
        XCTAssertEqual(requests[1].timeoutSeconds, AgentAPI.actionTimeoutSeconds)
    }

    func testQuickActionRequestsAskForAFreshClipboardRead() async throws {
        let transport = RecordingTransport(responses: [
            jsonResponse("{\"success\": true, \"action\": \"summary\", \"result\": \"ok\"}"),
        ])

        _ = try await AgentAPI(transport: transport).runAction(
            ActionRequest(action: "summary", fresh: true)
        )

        let requests = await transport.requests()
        let body = try jsonObject(requests[0].body)
        XCTAssertEqual(body["fresh"] as? Bool, true)
        XCTAssertNil(body["text"])
    }

    func testReportsStructuredHTTPErrors() async throws {
        let transport = RecordingTransport(responses: [
            jsonResponse("{\"error\":\"Unknown action\"}", statusCode: 400),
        ])

        do {
            _ = try await AgentAPI(transport: transport).runAction(ActionRequest(action: "missing"))
            XCTFail("expected request to fail")
        } catch let error as AgentAPIError {
            XCTAssertEqual(error, .httpStatus(400, "Unknown action"))
            XCTAssertEqual(error.localizedDescription, "Agent request failed (400): Unknown action")
        }
    }
}

private actor RecordingTransport: AgentTransport {
    private var queuedResponses: [AgentHTTPResponse]
    private var recordedRequests: [AgentHTTPRequest] = []

    init(responses: [AgentHTTPResponse]) {
        queuedResponses = responses
    }

    func send(_ request: AgentHTTPRequest) async throws -> AgentHTTPResponse {
        recordedRequests.append(request)
        guard !queuedResponses.isEmpty else {
            throw AgentAPIError.invalidResponse("No stub response")
        }
        return queuedResponses.removeFirst()
    }

    func requests() -> [AgentHTTPRequest] {
        recordedRequests
    }
}

private func jsonResponse(_ json: String, statusCode: Int = 200) -> AgentHTTPResponse {
    AgentHTTPResponse(
        statusCode: statusCode,
        headers: ["content-type": "application/json"],
        body: Data(json.utf8)
    )
}

private func jsonObject(_ body: Data?) throws -> [String: Any] {
    let data = try XCTUnwrap(body)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}
