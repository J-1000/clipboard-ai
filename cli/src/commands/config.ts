import { getConfig as defaultGetConfig } from "../lib/client.js";

export interface ConfigCommandDeps {
  getConfig: typeof defaultGetConfig;
}

export async function configCommand(deps: Partial<ConfigCommandDeps> = {}): Promise<void> {
  const getConfig = deps.getConfig ?? defaultGetConfig;
  try {
    const config = await getConfig();

    console.log("clipboard-ai configuration");
    console.log("──────────────────────────");
    console.log();
    console.log("Provider:");
    console.log(`  Type:     ${config.provider.type}`);
    console.log(`  Model:    ${config.provider.model}`);
    console.log(`  Endpoint: ${config.provider.endpoint}`);
    console.log(`  API key:  ${config.provider.api_key ? "[set]" : "[not set]"}`);
    console.log();
    console.log("Settings:");
    console.log(`  Poll interval:  ${config.settings.poll_interval}ms`);
    console.log(`  Safe mode:      ${config.settings.safe_mode}`);
    console.log(`  Notifications:  ${config.settings.notifications}`);
    console.log(`  Log level:      ${config.settings.log_level}`);
    console.log(`  HTTP enabled:   ${config.settings.http_enabled ?? false}`);
    if (config.settings.http_enabled) {
      console.log(`  HTTP address:   ${config.settings.http_addr ?? ""}`);
      console.log(
        `  HTTP token:     ${config.settings.http_auth_token ? "[set]" : "[missing]"}`
      );
    }
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
