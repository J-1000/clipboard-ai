import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, extname } from "path";
import { pathToFileURL } from "url";
import type { ActionContext, ActionDefinition } from "./action-types.js";

const SUPPORTED_PLUGIN_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
export const DEFAULT_PLUGIN_DIR = join(homedir(), ".clipboard-ai", "actions");

interface RawPluginAction {
  id?: unknown;
  aliases?: unknown;
  description?: unknown;
  progressMessage?: unknown;
  outputTitle?: unknown;
  run?: unknown;
}

interface PluginModuleWithMetadata {
  metadata?: RawPluginAction;
  run?: unknown;
}

export async function loadPluginActions(dir = DEFAULT_PLUGIN_DIR): Promise<ActionDefinition[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SUPPORTED_PLUGIN_EXTENSIONS.has(extname(name)))
    .sort();

  const actions: ActionDefinition[] = [];

  for (const fileName of entries) {
    const filePath = join(dir, fileName);

    try {
      const mod = await import(pathToFileURL(filePath).href);
      const candidate = normalizePluginModule(mod);

      if (!candidate) {
        console.error(`Warning: Skipping plugin ${fileName}: invalid action export`);
        continue;
      }

      actions.push(candidate);
    } catch (error) {
      console.error(`Warning: Failed to load plugin ${fileName}: ${(error as Error).message}`);
    }
  }

  return actions;
}

function normalizePluginModule(moduleValue: unknown): ActionDefinition | null {
  const moduleObj = moduleValue as Record<string, unknown>;
  const moduleWithMetadata = moduleValue as PluginModuleWithMetadata;

  const fromDefault = normalizeRawPlugin(moduleObj.default);
  if (fromDefault) {
    return fromDefault;
  }

  const fromNamedAction = normalizeRawPlugin(moduleObj.action);
  if (fromNamedAction) {
    return fromNamedAction;
  }

  if (moduleWithMetadata.metadata && moduleWithMetadata.run) {
    return normalizeRawPlugin({ ...moduleWithMetadata.metadata, run: moduleWithMetadata.run });
  }

  return normalizeRawPlugin(moduleValue);
}

function normalizeRawPlugin(value: unknown): ActionDefinition | null {
  const plugin = value as RawPluginAction;

  if (!plugin || typeof plugin !== "object") {
    return null;
  }

  if (typeof plugin.id !== "string" || plugin.id.length === 0) {
    return null;
  }

  if (typeof plugin.run !== "function") {
    return null;
  }

  const aliases = Array.isArray(plugin.aliases)
    ? plugin.aliases.filter((alias): alias is string => typeof alias === "string")
    : undefined;

  const runFn = plugin.run as (ctx: ActionContext) => Promise<string> | string;

  return {
    id: plugin.id,
    aliases,
    description:
      typeof plugin.description === "string" && plugin.description.length > 0
        ? plugin.description
        : `Plugin action: ${plugin.id}`,
    progressMessage: typeof plugin.progressMessage === "string" ? plugin.progressMessage : undefined,
    outputTitle:
      typeof plugin.outputTitle === "string" && plugin.outputTitle.length > 0
        ? plugin.outputTitle
        : plugin.id,
    run: async (ctx) => runFn(ctx),
  };
}
