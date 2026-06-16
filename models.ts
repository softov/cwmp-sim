// Binary-side model loading + the CLI→library options bridge. Like `storage.ts`,
// this lives OUTSIDE `src/` on purpose: the library and the config layer read no
// files. `buildOptions` (config) produces a `CliOptions` with model *names*; this
// module reads the model files and produces a fully-resolved `CwmpSimulatorOptions`
// (model *objects*) that the library consumes. The library never imports this.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCsvModel, parseJsonModel } from "./src/model/loader.ts";
import type { LoadedModel, CwmpSimulatorOptions, CwmpDeviceOptions, FleetGroup } from "./src/types.ts";
import type { CliOptions, CliDeviceOptions } from "./src/config/types.ts";

/** `default` / empty means "use the built-in tree" — no file is loaded. */
function isBuiltIn(name?: string): boolean {
  return !name || name.trim() === "" || name.trim().toLowerCase() === "default";
}

/**
 * Resolves a model reference to a file path. An explicit `.csv`/`.json` path is
 * used as-is; a bare name is looked up under `dir` as `name.csv` then `name.json`.
 */
function resolveModelPath(nameOrPath: string, dir: string): string {
  if (/\.(csv|json)$/i.test(nameOrPath)) return nameOrPath;
  for (const ext of [".csv", ".json"]) {
    const candidate = join(dir, nameOrPath + ext);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Model not found: '${nameOrPath}' (looked in '${dir}' for .csv / .json)`);
}

/**
 * Loads a device model by name or path (CSV or JSON, by extension), returning
 * `{ root, tree }`. Synchronous — model files are read once at startup.
 */
export function loadModel(nameOrPath: string, dir = "./models"): LoadedModel {
  const file = resolveModelPath(nameOrPath, dir);
  const text = readFileSync(file, "utf8");
  return /\.json$/i.test(file) ? parseJsonModel(text) : parseCsvModel(text);
}

/** Maps CLI device inputs to library device options (drops the `modelName` string). */
function toDevice(cli: CliDeviceOptions): CwmpDeviceOptions {
  const { modelName: _drop, ...device } = cli;
  return device;
}

/**
 * Bridges the CLI's parsed `CliOptions` to a resolved `CwmpSimulatorOptions`:
 * loads each group's model file (once per distinct name) into `group.model`, and
 * strips every CLI-only field. The returned object is pure data the library
 * consumes — `new CWMPSimulator(toSimulatorOptions(buildOptions(...)))`.
 */
export function toSimulatorOptions(cli: CliOptions): CwmpSimulatorOptions {
  const dir = cli.fleet?.modelsDir ?? "./models";
  const cache = new Map<string, LoadedModel>();
  const load = (name: string): LoadedModel => {
    let model = cache.get(name);
    if (!model) {
      model = loadModel(name, dir);
      cache.set(name, model);
    }
    return model;
  };

  const groups: FleetGroup[] = (cli.fleet?.groups ?? []).map((g) => ({
    count: g.count,
    device: toDevice(g.device),
    model: isBuiltIn(g.device.modelName) ? undefined : load(g.device.modelName!),
  }));

  return {
    device: toDevice(cli.device),
    conn: cli.conn,
    acs: cli.acs,
    log: cli.log,
    fleet: { count: cli.fleet?.count, bootDelay: cli.fleet?.bootDelay, groups },
  };
}
