import { getStatus as defaultGetStatus } from "../lib/client.js";

export interface StatusCommandDeps {
  getStatus: typeof defaultGetStatus;
}

export async function statusCommand(deps: Partial<StatusCommandDeps> = {}): Promise<void> {
  const getStatus = deps.getStatus ?? defaultGetStatus;
  try {
    const status = await getStatus();

    console.log("clipboard-ai agent");
    console.log("\u2500".repeat(18));
    console.log(`Status:  ${status.status}`);
    console.log(`Version: ${status.version}`);
    console.log(`Uptime:  ${status.uptime}`);
    console.log();
    console.log("Clipboard:");
    console.log(`  Type:      ${status.clipboard.type}`);
    console.log(`  Preview:   ${status.clipboard.text || "(empty)"}`);
    console.log(`  Timestamp: ${status.clipboard.timestamp || "N/A"}`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
