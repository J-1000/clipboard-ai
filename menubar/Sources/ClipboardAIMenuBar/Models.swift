import Foundation

struct AgentStatus: Decodable, Equatable, Sendable {
    let status: String
    let uptime: String
    let version: String
    let clipboard: ClipboardSummary
    let monitoring: MonitoringControls
}

struct ClipboardSummary: Decodable, Equatable, Sendable {
    let text: String
    let type: String
    let timestamp: String
}

struct MonitoringControls: Codable, Equatable, Sendable {
    let monitoring: Bool
    let paused: Bool
    let snoozedUntil: String?
    let defaultSnoozeMinutes: Int
    let appAllowlist: [String]
    let appDenylist: [String]
}

struct HistoryResponse: Decodable, Equatable, Sendable {
    let records: [HistoryRecord]
    let skippedCorrupt: Int?
}

struct HistoryRecord: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let timestamp: String
    let action: String
    let args: [String]
    let source: String
    let trigger: String
    let provider: String
    let providerProfile: String?
    let model: String
    let latencyMs: Int
    let status: String
    let copy: Bool
    let input: String
    let output: String?
    let error: String?
    let replayOf: String?

    var timestampDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: timestamp) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: timestamp)
    }
}

struct AgentConfiguration: Decodable, Equatable, Sendable {
    let provider: ProviderProfile
    let providers: [String: ProviderProfile]?
    let actions: [String: ActionConfiguration]
    let settings: SettingsConfiguration
    let privacy: PrivacyConfiguration
}

struct ProviderProfile: Decodable, Equatable, Sendable {
    let type: String
    let endpoint: String
    let model: String
    let apiKey: String?
    let fallbacks: [String]?
    let dailyTokenLimit: Int?
}

struct ActionConfiguration: Decodable, Equatable, Sendable {
    let enabled: Bool
    let trigger: String
    let prompt: String?
    let providerProfile: String?
    let fallbackProfiles: [String]?
    let dailyTokenLimit: Int?
    let model: String?
    let endpoint: String?
    let timeoutMs: Int?
    let retryCount: Int?
    let retryBackoffMs: Int?
    let cooldownMs: Int?
    let maxTokens: Int?
}

struct SettingsConfiguration: Decodable, Equatable, Sendable {
    let pollInterval: Int
    let safeMode: Bool
    let notifications: Bool
    let logLevel: String
    let clipboardDedupeWindowMs: Int?
    let httpEnabled: Bool?
    let httpAddr: String?
    let historyEnabled: Bool?
    let historyMaxEntries: Int?
    let historyTruncateChars: Int?
    let sensitiveGuard: String?
    let maxConcurrentActions: Int?
    let maxTokens: Int?
}

struct PrivacyConfiguration: Decodable, Equatable, Sendable {
    let startPaused: Bool
    let defaultSnoozeMinutes: Int
    let appAllowlist: [String]
    let appDenylist: [String]
}

struct ActionRequest: Encodable, Equatable, Sendable {
    let action: String
    let args: [String]
    let text: String?
    let type: String?

    init(action: String, args: [String] = [], text: String? = nil, type: String? = nil) {
        self.action = action
        self.args = args
        self.text = text
        self.type = type
    }
}

struct ActionResponse: Decodable, Equatable, Sendable {
    let success: Bool
    let action: String
    let result: String?
    let error: String?
}

struct ControlRequest: Encodable, Equatable, Sendable {
    let action: String
    let durationMinutes: Int?
}
