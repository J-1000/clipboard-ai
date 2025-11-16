import { getStatus } from "../lib/client.js";

export async function statusCommand(): Promise<void> {
  try {
    const status = await getStatus();

    console.log("clipboard-ai agent");
    console.log("──────────────────");
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
