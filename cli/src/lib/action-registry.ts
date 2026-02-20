import { builtinActions } from "./builtin-actions.js";
import type { ActionDefinition } from "./action-types.js";

export interface ActionRegistry {
  actions: ActionDefinition[];
  byId: Map<string, ActionDefinition>;
  byAlias: Map<string, ActionDefinition>;
}

export function createActionRegistry(actions: ActionDefinition[]): ActionRegistry {
  const byId = new Map<string, ActionDefinition>();
  const byAlias = new Map<string, ActionDefinition>();

  for (const action of actions) {
    byId.set(action.id, action);
    byAlias.set(action.id, action);

    for (const alias of action.aliases ?? []) {
      byAlias.set(alias, action);
    }
  }

  return { actions, byId, byAlias };
}

export function resolveAction(registry: ActionRegistry, name: string): ActionDefinition | undefined {
  return registry.byAlias.get(name);
}

export const defaultActionRegistry = createActionRegistry(builtinActions);
