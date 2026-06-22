import { getConfig as defaultGetConfig } from "../lib/client.js";
import { getActionRegistry as defaultGetActionRegistry } from "../lib/action-registry.js";

export interface ActionsCommandDeps {
  getConfig: typeof defaultGetConfig;
  getActionRegistry: typeof defaultGetActionRegistry;
}

export async function actionsCommand(
  deps: Partial<ActionsCommandDeps> & { json?: boolean } = {}
): Promise<void> {
  const getConfig = deps.getConfig ?? defaultGetConfig;
  const getActionRegistry = deps.getActionRegistry ?? defaultGetActionRegistry;
  try {
    const [config, registry] = await Promise.all([getConfig(), getActionRegistry()]);

    if (deps.json) {
      const items = registry.actions.map((action) => {
        const actionConfig = config.actions[action.id];
        return {
          id: action.id,
          description: action.description,
          aliases: action.aliases ?? [],
          enabled: actionConfig?.enabled ?? false,
          trigger: actionConfig?.trigger ?? "",
        };
      });
      console.log(JSON.stringify(items, null, 2));
      return;
    }

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
