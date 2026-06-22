import { mock } from "bun:test";
import type { AIClient } from "./lib/ai.js";
import type { ConfigResponse } from "./lib/client.js";
import type {
  ActionRunRecord,
  ActionRunRecordInput,
  HistoryRetentionSettings,
} from "./lib/history.js";

type ConfigOverrides = {
  provider?: Partial<ConfigResponse["provider"]>;
  actions?: ConfigResponse["actions"];
  settings?: Partial<ConfigResponse["settings"]>;
};

// Build a complete ConfigResponse for tests. `sensitive_guard` defaults to
// "off" so the guard never fires unless a test explicitly opts in.
export function makeConfig(overrides: ConfigOverrides = {}): ConfigResponse {
  return {
    provider: {
      type: "ollama",
      endpoint: "http://localhost:11434/v1",
      model: "mistral",
      ...overrides.provider,
    },
    actions: overrides.actions ?? {},
    settings: {
      poll_interval: 150,
      safe_mode: false,
      notifications: false,
      log_level: "info",
      sensitive_guard: "off",
      ...overrides.settings,
    },
  };
}

// Cast an object carrying just the AI methods a test needs into an AIClient.
export function fakeAIClient(methods: Partial<AIClient>): AIClient {
  return methods as unknown as AIClient;
}

// A properly typed appendHistoryRecord mock so `.mock.calls[n]` is a real
// tuple and assignment to RunActionDeps.appendHistoryRecord typechecks.
export function makeAppendHistoryMock() {
  return mock(
    (_input: ActionRunRecordInput, _settings?: HistoryRetentionSettings): Promise<ActionRunRecord> =>
      Promise.resolve(undefined as unknown as ActionRunRecord)
  );
}
