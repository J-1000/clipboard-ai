import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ControlsResponse } from "../lib/client.js";
import { pauseCommand, resumeCommand, snoozeCommand } from "./monitoring.js";

const baseStatus: ControlsResponse = {
  monitoring: true,
  paused: false,
  default_snooze_minutes: 15,
  app_allowlist: [],
  app_denylist: [],
};

describe("monitoring commands", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => mock.restore());

  it("pauses monitoring", async () => {
    const setMonitoringControl = mock(() =>
      Promise.resolve({ ...baseStatus, monitoring: false, paused: true })
    );
    await pauseCommand({ setMonitoringControl });
    expect(setMonitoringControl).toHaveBeenCalledWith("pause", undefined);
    expect(logSpy).toHaveBeenCalledWith("Clipboard monitoring paused.");
  });

  it("resumes monitoring", async () => {
    const setMonitoringControl = mock(() => Promise.resolve(baseStatus));
    await resumeCommand({ setMonitoringControl });
    expect(setMonitoringControl).toHaveBeenCalledWith("resume", undefined);
    expect(logSpy).toHaveBeenCalledWith("Clipboard monitoring resumed.");
  });

  it("snoozes monitoring for an explicit duration", async () => {
    const setMonitoringControl = mock(() =>
      Promise.resolve({
        ...baseStatus,
        monitoring: false,
        snoozed_until: "2026-08-18T13:00:00Z",
      })
    );
    await snoozeCommand(30, { setMonitoringControl });
    expect(setMonitoringControl).toHaveBeenCalledWith("snooze", 30);
    expect(logSpy).toHaveBeenCalledWith(
      "Clipboard monitoring snoozed until 2026-08-18T13:00:00Z."
    );
  });
});
