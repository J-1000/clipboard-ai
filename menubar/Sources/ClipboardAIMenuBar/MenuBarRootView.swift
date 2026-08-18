import AppKit
import SwiftUI

private enum MenuSection: String, CaseIterable, Identifiable {
    case recent
    case settings

    var id: Self { self }

    var title: String {
        switch self {
        case .recent:
            "Recent"
        case .settings:
            "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .recent:
            "clock"
        case .settings:
            "gearshape"
        }
    }
}

struct MenuBarRootView: View {
    @ObservedObject var store: MenuBarStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var section = MenuSection.recent

    var body: some View {
        ZStack(alignment: .leading) {
            Color(nsColor: .windowBackgroundColor)

            Rectangle()
                .fill(activityRailColor)
                .frame(width: 3)
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                MenuBarHeader(store: store)
                Divider()
                QuickActionBar(store: store, section: $section)
                Divider()
                sectionPicker
                Divider()
                sectionContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                footer
            }
            .padding(.leading, 3)
        }
        .frame(width: 580, height: 620)
        .tint(.clipboardAmber)
        .overlay(alignment: .bottom) {
            if let notice = store.notice {
                NoticeView(notice: notice)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 42)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .move(edge: .bottom).combined(with: .opacity)
                    )
            }
        }
        .animation(
            reduceMotion ? nil : .easeOut(duration: 0.18),
            value: store.notice?.id
        )
        .task {
            await store.loadIfNeeded()
        }
        .onAppear {
            guard store.status != nil else { return }
            Task {
                await store.refresh(showFailureNotice: false)
            }
        }
    }

    private var activityRailColor: Color {
        if store.isBusy {
            return .clipboardAmber
        }
        if store.monitoring?.monitoring == true {
            return .clipboardAmber.opacity(0.62)
        }
        return Color(nsColor: .separatorColor)
    }

    private var sectionPicker: some View {
        HStack {
            Picker("View", selection: $section) {
                ForEach(MenuSection.allCases) { item in
                    Label(item.title, systemImage: item.symbol)
                        .tag(item)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 230)

            Spacer()

            if store.isRefreshing {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Refreshing agent information")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .recent:
            HistoryBrowserView(store: store)
        case .settings:
            ConfigurationView(store: store)
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Text(agentVersionText)
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            Button("Refresh") {
                Task {
                    await store.refresh()
                }
            }
            .buttonStyle(.plain)
            .font(.caption)
            .keyboardShortcut("r", modifiers: .command)
            .disabled(store.isRefreshing)

            Divider()
                .frame(height: 12)

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
            .buttonStyle(.plain)
            .font(.caption)
            .keyboardShortcut("q", modifiers: .command)
        }
        .padding(.horizontal, 16)
        .frame(height: 34)
    }

    private var agentVersionText: String {
        guard let status = store.status else {
            return store.connectionError == nil ? "Connecting to agent…" : "Agent unavailable"
        }
        return "Agent \(status.version) · up \(status.uptime)"
    }
}

private struct MenuBarHeader: View {
    @ObservedObject var store: MenuBarStore

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: statusSymbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(statusColor)
                .frame(width: 22)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(statusTitle)
                    .font(.headline)
                Text(statusDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .help(statusDetail)
            }

            Spacer(minLength: 12)

            if let monitoring = store.monitoring {
                Button(monitoring.monitoring ? "Pause" : "Resume") {
                    Task {
                        await store.updateMonitoring(
                            monitoring.monitoring ? .pause : .resume
                        )
                    }
                }
                .controlSize(.small)
                .disabled(store.isChangingMonitoring)
                .help(monitoring.monitoring ? "Pause clipboard monitoring" : "Resume clipboard monitoring")

                Menu {
                    Button("15 minutes") {
                        snooze(minutes: 15)
                    }
                    Button("30 minutes") {
                        snooze(minutes: 30)
                    }
                    Button("1 hour") {
                        snooze(minutes: 60)
                    }
                    Divider()
                    Button("Default (\(monitoring.defaultSnoozeMinutes) min)") {
                        snooze(minutes: nil)
                    }
                } label: {
                    Label("Snooze", systemImage: "moon.zzz")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .disabled(store.isChangingMonitoring)
                .help("Temporarily stop clipboard monitoring")
            } else if store.isRefreshing {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Connecting to clipboard-ai-agent")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 62)
        .accessibilityElement(children: .contain)
    }

    private var statusTitle: String {
        if store.connectionError != nil, store.status == nil {
            return "Agent unavailable"
        }
        guard let monitoring = store.monitoring else {
            return "Clipboard AI"
        }
        if monitoring.monitoring {
            return "Monitoring clipboard"
        }
        if monitoring.snoozedUntil != nil {
            return "Monitoring snoozed"
        }
        return "Monitoring paused"
    }

    private var statusDetail: String {
        if let error = store.connectionError, store.status == nil {
            return error
        }
        if let runningActionID = store.runningActionID {
            return "Running \(store.displayName(for: runningActionID))…"
        }
        guard let monitoring = store.monitoring else {
            return "Connecting to the local agent…"
        }
        if let snoozedUntil = monitoring.snoozedUntil,
           let date = parseISO8601(snoozedUntil)
        {
            return "Resumes \(date.formatted(date: .omitted, time: .shortened))"
        }
        if monitoring.monitoring {
            return "Local controls are ready"
        }
        return "Clipboard changes are not being read"
    }

    private var statusSymbol: String {
        if store.connectionError != nil, store.status == nil {
            return "exclamationmark.triangle.fill"
        }
        if store.runningActionID != nil {
            return "bolt.horizontal.circle.fill"
        }
        if store.monitoring?.monitoring == true {
            return "checkmark.circle.fill"
        }
        return "pause.circle.fill"
    }

    private var statusColor: Color {
        if store.connectionError != nil, store.status == nil {
            return .red
        }
        if store.runningActionID != nil || store.monitoring?.monitoring == true {
            return .clipboardAmber
        }
        return .secondary
    }

    private func snooze(minutes: Int?) {
        Task {
            await store.updateMonitoring(.snooze(minutes: minutes))
        }
    }
}

private struct QuickActionBar: View {
    @ObservedObject var store: MenuBarStore
    @Binding var section: MenuSection

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("RUN ON CLIPBOARD")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)

            HStack(spacing: 7) {
                ForEach(MenuBarStore.primaryQuickActions) { action in
                    Button {
                        run(action)
                    } label: {
                        HStack(spacing: 5) {
                            actionIcon(for: action)
                            Text(action.title)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .controlSize(.small)
                    .disabled(store.runningActionID != nil)
                    .help(action.help)
                    .accessibilityLabel(action.help)
                }

                Menu {
                    ForEach(MenuBarStore.secondaryQuickActions) { action in
                        Button {
                            run(action)
                        } label: {
                            Label(action.title, systemImage: action.symbol)
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 16)
                        .accessibilityLabel("More clipboard actions")
                }
                .controlSize(.small)
                .disabled(store.runningActionID != nil)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.38))
    }

    @ViewBuilder
    private func actionIcon(for action: QuickActionDefinition) -> some View {
        if store.runningActionID == action.id {
            ProgressView()
                .controlSize(.mini)
                .accessibilityHidden(true)
        } else {
            Image(systemName: action.symbol)
                .accessibilityHidden(true)
        }
    }

    private func run(_ action: QuickActionDefinition) {
        section = .recent
        Task {
            await store.runQuickAction(action)
        }
    }
}

private struct HistoryBrowserView: View {
    @ObservedObject var store: MenuBarStore

    var body: some View {
        if store.history.isEmpty, store.latestResult == nil {
            HistoryEmptyView(
                isLoading: store.isRefreshing,
                errorMessage: store.connectionError
            )
        } else {
            HStack(spacing: 0) {
                historyList
                    .frame(width: 216)
                Divider()
                HistoryDetailView(store: store)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var historyList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(store.history) { record in
                    Button {
                        store.selectHistoryRecord(record.id)
                    } label: {
                        HistoryRow(
                            record: record,
                            actionName: store.displayName(for: record.action),
                            isSelected: store.selectedRecordID == record.id
                                && store.latestResult == nil
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(historyAccessibilityLabel(for: record))

                    Divider()
                        .padding(.leading, 14)
                }
            }
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.24))
    }

    private func historyAccessibilityLabel(for record: HistoryRecord) -> String {
        let result = record.status == "success" ? "succeeded" : "failed"
        return "\(store.displayName(for: record.action)), \(result), \(relativeTime(record.timestampDate))"
    }
}

private struct HistoryRow: View {
    let record: HistoryRecord
    let actionName: String
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: record.status == "success" ? "checkmark.circle" : "exclamationmark.circle")
                .foregroundStyle(record.status == "success" ? Color.secondary : Color.red)
                .padding(.top, 2)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(actionName)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(relativeTime(record.timestampDate))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Text(previewText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(isSelected ? Color.clipboardAmber.opacity(0.13) : .clear)
        .overlay(alignment: .leading) {
            if isSelected {
                Rectangle()
                    .fill(Color.clipboardAmber)
                    .frame(width: 3)
            }
        }
        .contentShape(Rectangle())
    }

    private var previewText: String {
        if record.status != "success" {
            return record.error ?? "Action failed"
        }
        return record.output ?? "No result retained"
    }
}

private struct HistoryDetailView: View {
    @ObservedObject var store: MenuBarStore

    var body: some View {
        if let latestResult = store.latestResult {
            latestResultView(latestResult)
        } else if let record = store.selectedRecord {
            recordView(record)
        } else {
            ContentUnavailableView(
                "Select a Run",
                systemImage: "clock",
                description: Text("Choose a recent action to inspect its input and result.")
            )
        }
    }

    private func latestResultView(_ result: ActionRunResult) -> some View {
        VStack(spacing: 0) {
            detailHeader(
                eyebrow: "JUST RAN",
                title: store.displayName(for: result.action),
                symbol: "checkmark.circle.fill",
                symbolColor: .clipboardAmber
            )

            Divider()

            ScrollView {
                ResultTextSection(title: "RESULT", text: result.output)
                    .padding(16)
            }

            Divider()

            HStack {
                Spacer()
                Button {
                    store.copyLatestResult()
                } label: {
                    Label("Copy Result", systemImage: "doc.on.doc")
                }
                .keyboardShortcut("c", modifiers: .command)
            }
            .padding(12)
        }
    }

    private func recordView(_ record: HistoryRecord) -> some View {
        VStack(spacing: 0) {
            detailHeader(
                eyebrow: record.status == "success" ? "COMPLETED" : "FAILED",
                title: store.displayName(for: record.action),
                symbol: record.status == "success" ? "checkmark.circle.fill" : "exclamationmark.circle.fill",
                symbolColor: record.status == "success" ? .secondary : .red
            )

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    metadata(for: record)
                    ResultTextSection(title: "INPUT", text: record.input)
                    if let output = record.output, !output.isEmpty {
                        ResultTextSection(title: "RESULT", text: output)
                    }
                    if let error = record.error, !error.isEmpty {
                        ResultTextSection(title: "ERROR", text: error, isError: true)
                    }
                }
                .padding(16)
            }

            Divider()

            HStack(spacing: 8) {
                Button {
                    Task {
                        await store.runAgain(record)
                    }
                } label: {
                    Label("Run Again", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(!store.canRunAgain(record))
                .help(runAgainHelp(for: record))

                Spacer()

                Button {
                    store.copyResult(from: record)
                } label: {
                    Label("Copy Result", systemImage: "doc.on.doc")
                }
                .keyboardShortcut("c", modifiers: .command)
                .disabled(record.output?.isEmpty != false)
            }
            .padding(12)
        }
    }

    private func detailHeader(
        eyebrow: String,
        title: String,
        symbol: String,
        symbolColor: Color
    ) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(eyebrow)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.title3.weight(.semibold))
            }
            Spacer()
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(symbolColor)
                .accessibilityLabel(eyebrow.capitalized)
        }
        .padding(.horizontal, 16)
        .frame(height: 62)
    }

    private func metadata(for record: HistoryRecord) -> some View {
        VStack(spacing: 7) {
            MetadataRow(
                label: "Time",
                value: record.timestampDate?.formatted(date: .abbreviated, time: .shortened)
                    ?? record.timestamp
            )
            MetadataRow(
                label: "Provider",
                value: providerDescription(for: record)
            )
            MetadataRow(
                label: "Source",
                value: "\(record.source) · \(record.trigger)"
            )
            MetadataRow(
                label: "Latency",
                value: "\(record.latencyMs.formatted()) ms"
            )
        }
    }

    private func providerDescription(for record: HistoryRecord) -> String {
        let profile = record.providerProfile.map { " · \($0)" } ?? ""
        let model = record.model.isEmpty ? "" : " · \(record.model)"
        return "\(record.provider)\(profile)\(model)"
    }

    private func runAgainHelp(for record: HistoryRecord) -> String {
        if store.canRunAgain(record) {
            return "Run this action again with its retained input"
        }
        return "The original input was not retained, so this run cannot be replayed"
    }
}

private struct MetadataRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 58, alignment: .leading)
            Text(value)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(value)
            Spacer(minLength: 0)
        }
        .font(.caption)
    }
}

private struct ResultTextSection: View {
    let title: String
    let text: String
    var isError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(isError ? Color.red : Color.secondary)
                .accessibilityAddTraits(.isHeader)

            Text(text)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(nsColor: .textBackgroundColor).opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }
}

private struct HistoryEmptyView: View {
    let isLoading: Bool
    let errorMessage: String?

    var body: some View {
        if isLoading {
            VStack(spacing: 10) {
                ProgressView()
                Text("Loading recent actions…")
                    .foregroundStyle(.secondary)
            }
        } else if let errorMessage {
            ContentUnavailableView(
                "Agent Unavailable",
                systemImage: "exclamationmark.triangle",
                description: Text("\(errorMessage) Start clipboard-ai-agent, then choose Refresh.")
            )
        } else {
            ContentUnavailableView(
                "No Recent Actions",
                systemImage: "clock",
                description: Text("Run an action on the current clipboard to see its result here.")
            )
        }
    }
}

private struct ConfigurationView: View {
    @ObservedObject var store: MenuBarStore

    var body: some View {
        if let configuration = store.configuration {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("Active configuration from the local agent. Secrets are redacted and changes are made in config.yaml.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    providerSection(configuration)
                    behaviorSection(configuration.settings)
                    privacySection(configuration.privacy)
                    actionsSection(configuration.actions)
                }
                .padding(16)
            }
        } else if store.isRefreshing {
            ProgressView("Loading settings…")
        } else {
            ContentUnavailableView(
                "Settings Unavailable",
                systemImage: "gearshape",
                description: Text(store.connectionError ?? "The agent did not return its active configuration.")
            )
        }
    }

    private func providerSection(_ configuration: AgentConfiguration) -> some View {
        SettingsGroup(title: "PROVIDERS") {
            LabeledValueRow(label: "Default", value: providerSummary(configuration.provider))
            if let providers = configuration.providers, !providers.isEmpty {
                ForEach(providers.keys.sorted(), id: \.self) { name in
                    if let profile = providers[name] {
                        Divider()
                        LabeledValueRow(label: name, value: providerSummary(profile))
                    }
                }
            }
        }
    }

    private func behaviorSection(_ settings: SettingsConfiguration) -> some View {
        SettingsGroup(title: "BEHAVIOR") {
            LabeledValueRow(label: "Safe mode", value: enabledText(settings.safeMode))
            Divider()
            LabeledValueRow(label: "Sensitive guard", value: settings.sensitiveGuard ?? "off")
            Divider()
            LabeledValueRow(
                label: "Polling",
                value: "\(settings.pollInterval / 1_000_000) ms"
            )
            Divider()
            LabeledValueRow(
                label: "Concurrency",
                value: "\(settings.maxConcurrentActions ?? 1) action(s)"
            )
            Divider()
            LabeledValueRow(
                label: "History",
                value: historyDescription(settings)
            )
        }
    }

    private func privacySection(_ privacy: PrivacyConfiguration) -> some View {
        SettingsGroup(title: "PRIVACY") {
            LabeledValueRow(label: "Start paused", value: enabledText(privacy.startPaused))
            Divider()
            LabeledValueRow(
                label: "Default snooze",
                value: "\(privacy.defaultSnoozeMinutes) minutes"
            )
            Divider()
            LabeledValueRow(
                label: "Allowed apps",
                value: listDescription(privacy.appAllowlist, empty: "All apps")
            )
            Divider()
            LabeledValueRow(
                label: "Blocked apps",
                value: listDescription(privacy.appDenylist, empty: "None")
            )
        }
    }

    private func actionsSection(_ actions: [String: ActionConfiguration]) -> some View {
        SettingsGroup(title: "ACTIONS") {
            ForEach(Array(actions.keys.sorted().enumerated()), id: \.element) { index, name in
                if index > 0 {
                    Divider()
                }
                if let action = actions[name] {
                    ActionConfigurationRow(
                        name: store.displayName(for: name),
                        action: action
                    )
                }
            }
        }
    }

    private func providerSummary(_ provider: ProviderProfile) -> String {
        var pieces = [provider.type]
        if !provider.model.isEmpty {
            pieces.append(provider.model)
        }
        if let fallbacks = provider.fallbacks, !fallbacks.isEmpty {
            pieces.append("fallbacks: \(fallbacks.joined(separator: ", "))")
        }
        if let limit = provider.dailyTokenLimit {
            pieces.append("\(limit.formatted()) tokens/day")
        }
        return pieces.joined(separator: " · ")
    }

    private func historyDescription(_ settings: SettingsConfiguration) -> String {
        guard settings.historyEnabled != false else { return "Off" }
        if let maximum = settings.historyMaxEntries {
            return "On · \(maximum.formatted()) entries"
        }
        return "On"
    }

    private func listDescription(_ values: [String], empty: String) -> String {
        values.isEmpty ? empty : values.joined(separator: ", ")
    }

    private func enabledText(_ enabled: Bool) -> String {
        enabled ? "On" : "Off"
    }
}

private struct SettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)

            VStack(spacing: 8) {
                content
            }
            .padding(.leading, 1)
        }
    }
}

private struct LabeledValueRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 112, alignment: .leading)
            Text(value)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }
}

private struct ActionConfigurationRow: View {
    let name: String
    let action: ActionConfiguration

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: action.enabled ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(action.enabled ? Color.clipboardAmber : Color.secondary)
                .accessibilityLabel(action.enabled ? "Enabled" : "Disabled")

            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(.subheadline.weight(.medium))
                Text(actionDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }

    private var actionDetail: String {
        var pieces = [action.enabled ? "Automatic trigger enabled" : "Manual only"]
        if let profile = action.providerProfile, !profile.isEmpty {
            pieces.append(profile)
        }
        if let model = action.model, !model.isEmpty {
            pieces.append(model)
        }
        return pieces.joined(separator: " · ")
    }
}

private struct NoticeView: View {
    let notice: MenuNotice

    var body: some View {
        Label(notice.message, systemImage: symbol)
            .font(.callout.weight(.medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(borderColor.opacity(0.5), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
            .accessibilityAddTraits(.isStaticText)
    }

    private var symbol: String {
        notice.kind == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }

    private var borderColor: Color {
        notice.kind == .success ? .clipboardAmber : .red
    }
}

private func relativeTime(_ date: Date?) -> String {
    guard let date else { return "Unknown" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}

private func parseISO8601(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

private extension Color {
    static let clipboardAmber = Color(nsColor: .systemOrange)
}
