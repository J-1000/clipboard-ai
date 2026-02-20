import { builtinActions } from "./builtin-actions.js";
import type { ActionDefinition } from "./action-types.js";
import { loadPluginActions } from "./plugin-actions.js";

export interface ActionRegistry {
  actions: ActionDefinition[];
  byId: Map<string, ActionDefinition>;
  byAlias: Map<string, ActionDefinition>;
}

export function createActionRegistry(actions: ActionDefinition[]): ActionRegistry {
  const byId = new Map<string, ActionDefinition>();
  const byAlias = new Map<string, ActionDefinition>();

  for (const action of actions) {
    if (byId.has(action.id)) {
      throw new Error(`Duplicate action id: ${action.id}`);
    }
    byId.set(action.id, action);
    registerAlias(byAlias, action.id, action);

    for (const alias of action.aliases ?? []) {
      registerAlias(byAlias, alias, action);
    }
  }

  return { actions, byId, byAlias };
}

export function resolveAction(registry: ActionRegistry, name: string): ActionDefinition | undefined {
  return registry.byAlias.get(name);
}

export const defaultActionRegistry = createActionRegistry(builtinActions);

let cachedActionRegistry: ActionRegistry | null = null;

export async function getActionRegistry(): Promise<ActionRegistry> {
  if (cachedActionRegistry) {
    return cachedActionRegistry;
  }

  const pluginActions = await loadPluginActions();
  const mergedActions = mergeActions(builtinActions, pluginActions);
  cachedActionRegistry = createActionRegistry(mergedActions);
  return cachedActionRegistry;
}

function mergeActions(
  baseActions: ActionDefinition[],
  pluginActions: ActionDefinition[]
): ActionDefinition[] {
  const usedNames = new Set<string>();
  const actions: ActionDefinition[] = [...baseActions];

  for (const action of baseActions) {
    usedNames.add(action.id);
    for (const alias of action.aliases ?? []) {
      usedNames.add(alias);
    }
  }

  for (const pluginAction of pluginActions) {
    const names = [pluginAction.id, ...(pluginAction.aliases ?? [])];
    const conflicts = names.filter((name) => usedNames.has(name));
    if (conflicts.length > 0) {
      console.error(
        `Warning: Skipping plugin action "${pluginAction.id}" due to name conflicts: ${conflicts.join(", ")}`
      );
      continue;
    }

    actions.push(pluginAction);
    for (const name of names) {
      usedNames.add(name);
    }
  }

  return actions;
}

function registerAlias(
  byAlias: Map<string, ActionDefinition>,
  alias: string,
  action: ActionDefinition
): void {
  const existing = byAlias.get(alias);
  if (existing) {
    throw new Error(`Duplicate action name or alias: ${alias}`);
  }
  byAlias.set(alias, action);
}
