// Binary-side model loading + the CLI→library options bridge. Like `storage.ts`,
// this lives OUTSIDE `src/` on purpose: the library and the config layer read no
// files. `buildOptions` (config) produces a `CliOptions` with model *names*; this
// module reads the model files and produces a fully-resolved `CwmpSimulatorOptions`
// (model *objects*) that the library consumes. The library never imports this.

import { readFileSync } from "node:fs";
import { parseCsvModel, parseJsonModel } from "./src/model/loader.ts";
import type { LoadedModel, CwmpFleetOptions, CwmpDeviceOptions, FleetGroup } from "./src/types.ts";
import type { CliFleet, CliDeviceOptions } from "./src/config/types.ts";

/** `default` / empty means "use the built-in tree" — no file is loaded. */
function isBuiltIn(name?: string): boolean {
  return !name || name.trim() === "" || name.trim().toLowerCase() === "default";
}

/**
 * Loads a device model from a **file path** (`.csv` or `.json`, by extension),
 * returning `{ root, tree }`. The path may be relative (to cwd) or absolute —
 * each `--model` is an independent path, so models can live in any folder.
 * Synchronous — read once at startup.
 */
export function loadModel(path: string): LoadedModel {
  if (!/\.(csv|json)$/i.test(path)) {
    throw new Error(`Model must be a .csv or .json file: '${path}'`);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Model file not found: '${path}'`);
  }
  return /\.json$/i.test(path) ? parseJsonModel(text) : parseCsvModel(text);
}

/** Maps CLI device inputs to library device options (drops the `modelName` string). */
function toDevice(cli: CliDeviceOptions): CwmpDeviceOptions {
  const { modelName: _drop, ...device } = cli;
  return device;
}

/**
 * Resolves a parsed CLI fleet into the library's `CwmpFleetOptions`: loads each
 * group's model **file** (once per distinct path) into `group.model` and strips
 * CLI-only fields (`modelName`). Returns **only the fleet** — the caller composes
 * the full `CwmpSimulatorOptions` from the CLI's `conn`/`acs`/`log`. The library
 * reads no files; this is where model paths become objects.
 */
export function resolveFleet(fleet?: CliFleet): CwmpFleetOptions {
  const cache = new Map<string, LoadedModel>();
  const load = (path: string): LoadedModel => {
    let model = cache.get(path);
    if (!model) {
      model = loadModel(path);
      cache.set(path, model);
    }
    return model;
  };

  const groups: FleetGroup[] = (fleet?.groups ?? []).map((g) => ({
    count: g.count,
    device: toDevice(g.device),
    model: isBuiltIn(g.device.modelName) ? undefined : load(g.device.modelName!),
  }));

  return { bootDelay: fleet?.bootDelay, index: fleet?.index, groups };
}
