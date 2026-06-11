import { getConfig } from "../lib/client.js";
import { getActionRegistry } from "../lib/action-registry.js";

export async function actionsCommand(): Promise<void> {
  try {
    const [config, registry] = await Promise.all([getConfig(), getActionRegistry()]);

    console.log("Registered actions");
    console.log("──────────────────");

    for (const action of registry.actions) {
      const actionConfig = config.actions[action.id];
      const enabled = actionConfig?.enabled ?? false;
      const trigger = actionConfig?.trigger ?? "";
      const aliases = action.aliases && action.aliases.length > 0 ? action.aliases.join(", ") : "-";

      console.log(`${enabled ? "✓" : "✗"} ${action.id}`);
      console.log(`  Description: ${action.description}`);
      console.log(`  Aliases:     ${aliases}`);
      console.log(`  Enabled:     ${enabled}`);
      console.log(`  Trigger:     ${trigger || "-"}`);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
