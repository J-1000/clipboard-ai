import { setMonitoringControl as defaultSetMonitoringControl } from "../lib/client.js";

export interface MonitoringCommandDeps {
  setMonitoringControl: typeof defaultSetMonitoringControl;
}

export async function pauseCommand(deps: Partial<MonitoringCommandDeps> = {}): Promise<void> {
  await runControl("pause", undefined, deps);
}

export async function resumeCommand(deps: Partial<MonitoringCommandDeps> = {}): Promise<void> {
  await runControl("resume", undefined, deps);
}

export async function snoozeCommand(
  durationMinutes?: number,
  deps: Partial<MonitoringCommandDeps> = {}
): Promise<void> {
  await runControl("snooze", durationMinutes, deps);
}

async function runControl(
  action: "pause" | "resume" | "snooze",
  durationMinutes: number | undefined,
  deps: Partial<MonitoringCommandDeps>
): Promise<void> {
  const setMonitoringControl = deps.setMonitoringControl ?? defaultSetMonitoringControl;
  try {
    const status = await setMonitoringControl(action, durationMinutes);
    if (status.monitoring) {
      console.log("Clipboard monitoring resumed.");
    } else if (status.snoozed_until) {
      console.log(`Clipboard monitoring snoozed until ${status.snoozed_until}.`);
    } else {
      console.log("Clipboard monitoring paused.");
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
