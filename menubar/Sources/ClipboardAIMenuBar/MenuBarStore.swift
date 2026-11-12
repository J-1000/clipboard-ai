import AppKit
import Combine
import Foundation

struct QuickActionDefinition: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let symbol: String
    let help: String
}

struct ActionRunResult: Equatable, Sendable {
    let action: String
    let output: String
}

struct MenuNotice: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case success
        case error
    }

    let id = UUID()
    let kind: Kind
    let message: String
}

@MainActor
final class MenuBarStore: ObservableObject {
    static let primaryQuickActions = [
        QuickActionDefinition(
            id: "summary",
            title: "Summarize",
            symbol: "text.alignleft",
            help: "Summarize the current clipboard"
        ),
        QuickActionDefinition(
            id: "explain",
            title: "Explain",
            symbol: "lightbulb",
            help: "Explain the current clipboard"
        ),
        QuickActionDefinition(
            id: "improve",
            title: "Improve",
            symbol: "wand.and.sparkles",
            help: "Improve the writing on the current clipboard"
        ),
        QuickActionDefinition(
            id: "tldr",
            title: "TL;DR",
            symbol: "text.badge.minus",
            help: "Create a short version of the current clipboard"
        ),
    ]

    static let secondaryQuickActions = [
        QuickActionDefinition(
            id: "classify",
            title: "Classify",
            symbol: "tag",
            help: "Classify the current clipboard"
        ),
        QuickActionDefinition(
            id: "extract",
            title: "Extract",
            symbol: "list.bullet.rectangle",
            help: "Extract structured information from the current clipboard"
        ),
        QuickActionDefinition(
            id: "caption",
            title: "Caption Image",
            symbol: "photo.badge.checkmark",
            help: "Caption the image on the current clipboard"
        ),
        QuickActionDefinition(
            id: "ocr",
            title: "Read Image Text",
            symbol: "text.viewfinder",
            help: "Read text from the image on the current clipboard"
        ),
    ]

    @Published private(set) var status: AgentStatus?
    @Published private(set) var monitoring: MonitoringControls?
    @Published private(set) var history: [HistoryRecord] = []
    @Published private(set) var configuration: AgentConfiguration?
    @Published private(set) var latestResult: ActionRunResult?
    @Published private(set) var notice: MenuNotice?
    @Published private(set) var connectionError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var runningActionID: String?
    @Published private(set) var isChangingMonitoring = false
    @Published var selectedRecordID: String?

    private let api: any AgentServing
    private var hasLoaded = false
    private var noticeTask: Task<Void, Never>?

    init(api: any AgentServing = AgentAPI()) {
        self.api = api
    }

    var selectedRecord: HistoryRecord? {
        guard let selectedRecordID else { return nil }
        return history.first { $0.id == selectedRecordID }
    }

    var isBusy: Bool {
        isRefreshing || runningActionID != nil || isChangingMonitoring
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await refresh()
    }

    func refresh(showFailureNotice: Bool = true) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer {
            isRefreshing = false
            hasLoaded = true
        }

        let api = api
        do {
            async let statusRequest = api.status()
            async let historyRequest = api.history(limit: 50)
            async let configurationRequest = api.configuration()
            let (newStatus, historyResponse, newConfiguration) = try await (
                statusRequest,
                historyRequest,
                configurationRequest
            )

            status = newStatus
            monitoring = newStatus.monitoring
            history = historyResponse.records
            configuration = newConfiguration
            connectionError = nil
            preserveOrSelectHistoryRecord()
        } catch {
            connectionError = displayMessage(for: error)
            if showFailureNotice {
                showNotice(.error, connectionError ?? "The agent could not be reached.")
            }
        }
    }

    func selectHistoryRecord(_ id: String?) {
        latestResult = nil
        selectedRecordID = id
    }

    func runQuickAction(_ action: QuickActionDefinition) async {
        await execute(
            request: ActionRequest(action: action.id, fresh: true),
            displayName: action.title
        )
    }

    func runAgain(_ record: HistoryRecord) async {
        let input = record.input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isReplayableHistoryInput(input) else {
            showNotice(
                .error,
                "This run cannot be replayed because its original input was not retained."
            )
            return
        }

        await execute(
            request: ActionRequest(
                action: record.action,
                args: record.args,
                text: input,
                type: "text"
            ),
            displayName: displayName(for: record.action)
        )
    }

    func copyResult(from record: HistoryRecord) {
        guard let output = record.output, !output.isEmpty else {
            showNotice(.error, "This run does not have a result to copy.")
            return
        }
        copyToPasteboard(output)
    }

    func copyLatestResult() {
        guard let latestResult else {
            showNotice(.error, "There is no recent result to copy.")
            return
        }
        copyToPasteboard(latestResult.output)
    }

    func updateMonitoring(_ action: MonitoringAction) async {
        guard !isChangingMonitoring else { return }
        isChangingMonitoring = true
        defer { isChangingMonitoring = false }

        do {
            let updated = try await api.setControl(action)
            monitoring = updated
            updateStatusMonitoring(updated)
            connectionError = nil
            showNotice(.success, monitoringSuccessMessage(for: action))
        } catch {
            showNotice(.error, displayMessage(for: error))
        }
    }

    func canRunAgain(_ record: HistoryRecord) -> Bool {
        isReplayableHistoryInput(record.input.trimmingCharacters(in: .whitespacesAndNewlines))
            && runningActionID == nil
    }

    func displayName(for actionID: String) -> String {
        actionID
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    private func execute(request: ActionRequest, displayName: String) async {
        guard runningActionID == nil else { return }
        runningActionID = request.action
        defer { runningActionID = nil }

        do {
            let response = try await api.runAction(request)
            guard response.success else {
                throw MenuBarStoreError.actionFailed(
                    response.error ?? "The action did not return a result."
                )
            }
            guard let result = response.result, !result.isEmpty else {
                throw MenuBarStoreError.actionFailed("The action returned an empty result.")
            }

            latestResult = ActionRunResult(action: response.action, output: result)
            connectionError = nil
            do {
                try await refreshHistory(selectNewest: true)
            } catch {
                showNotice(
                    .success,
                    "\(displayName) finished. History could not be refreshed."
                )
                return
            }
            showNotice(.success, "\(displayName) finished.")
        } catch {
            showNotice(.error, displayMessage(for: error))
        }
    }

    private func refreshHistory(selectNewest: Bool) async throws {
        let response = try await api.history(limit: 50)
        history = response.records
        if selectNewest, let newest = history.first {
            selectedRecordID = newest.id
        } else {
            preserveOrSelectHistoryRecord()
        }
    }

    private func preserveOrSelectHistoryRecord() {
        if let selectedRecordID, history.contains(where: { $0.id == selectedRecordID }) {
            return
        }
        selectedRecordID = history.first?.id
    }

    private func isReplayableHistoryInput(_ input: String) -> Bool {
        !input.isEmpty
            && input != "[sensitive content omitted]"
            && input != "[image]"
    }

    private func copyToPasteboard(_ output: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setString(output, forType: .string) else {
            showNotice(.error, "macOS could not copy the result.")
            return
        }
        showNotice(.success, "Result copied to the clipboard.")
    }

    private func updateStatusMonitoring(_ updated: MonitoringControls) {
        guard let status else { return }
        self.status = AgentStatus(
            status: status.status,
            uptime: status.uptime,
            version: status.version,
            clipboard: status.clipboard,
            monitoring: updated
        )
    }

    private func monitoringSuccessMessage(for action: MonitoringAction) -> String {
        switch action {
        case .pause:
            "Clipboard monitoring paused."
        case .resume:
            "Clipboard monitoring resumed."
        case let .snooze(minutes):
            "Clipboard monitoring snoozed for \(minutes ?? monitoring?.defaultSnoozeMinutes ?? 15) minutes."
        }
    }

    private func displayMessage(for error: Error) -> String {
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription,
           !description.isEmpty
        {
            return description
        }
        return error.localizedDescription
    }

    private func showNotice(_ kind: MenuNotice.Kind, _ message: String) {
        noticeTask?.cancel()
        notice = MenuNotice(kind: kind, message: message)
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }
}

private enum MenuBarStoreError: LocalizedError {
    case actionFailed(String)

    var errorDescription: String? {
        switch self {
        case let .actionFailed(message):
            message
        }
    }
}
