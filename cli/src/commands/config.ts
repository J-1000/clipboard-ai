import { getConfig } from "../lib/client.js";

export async function configCommand(): Promise<void> {
  try {
    const config = await getConfig();

    console.log("clipboard-ai configuration");
    console.log("──────────────────────────");
    console.log();
    console.log("Provider:");
    console.log(`  Type:     ${config.provider.type}`);
    console.log(`  Model:    ${config.provider.model}`);
    console.log(`  Endpoint: ${config.provider.endpoint}`);
    console.log();
    console.log("Settings:");
    console.log(`  Poll interval:  ${config.settings.poll_interval}ms`);
    console.log(`  Safe mode:      ${config.settings.safe_mode}`);
    console.log(`  Notifications:  ${config.settings.notifications}`);
    console.log(`  Log level:      ${config.settings.log_level}`);
    console.log();
    console.log("Actions:");
    for (const [name, action] of Object.entries(config.actions)) {
      const status = action.enabled ? "✓" : "✗";
      console.log(`  ${status} ${name}: ${action.trigger}`);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
