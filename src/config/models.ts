import type { CwmpSimulatorOptions, LoadedModel } from "../types.ts";
import { loadModel } from "../model/loader.ts";

/** `default` / empty means "use the built-in tree", so no model is loaded. */
function isBuiltIn(name?: string): boolean {
  return !name || name.trim() === "" || name.trim().toLowerCase() === "default";
}

/**
 * Resolves every group's model name/path into a loaded `{ root, tree }` on
 * `group.model`. Each distinct model is loaded once (cached by name) and
 * shared across that group's devices — file I/O happens here, in the config
 * layer, never in the device/simulator. `default` / empty → built-in tree.
 *
 * Falls back to the single `options.device.modelName` when no `fleet.groups`
 * are present (programmatic callers). Mutates and returns options.
 */
export async function resolveModels(options: CwmpSimulatorOptions): Promise<CwmpSimulatorOptions> {
  const dir = options.fleet?.modelsDir ?? "./models";
  const cache = new Map<string, LoadedModel>();

  const load = async (name: string): Promise<LoadedModel> => {
    let tpl = cache.get(name);
    if (!tpl) {
      tpl = await loadModel(name, dir);
      cache.set(name, tpl);
    }
    return tpl;
  };

  if (options.fleet?.groups?.length) {
    for (const group of options.fleet.groups) {
      if (group.model) continue; // already supplied
      const name = group.device?.modelName;
      if (isBuiltIn(name)) continue;
      group.model = await load(name!);
    }
  } else if (!isBuiltIn(options.device.modelName) && !options.device.model) {
    options.device.model = await load(options.device.modelName!);
  }

  return options;
}
