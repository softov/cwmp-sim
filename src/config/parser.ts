import type { CwmpSimulatorOptions, FleetGroup } from "../types.ts";
import { configFields, type ConfigField } from "./fields.ts";

const MODEL_FLAG = "--model";

function setPath(target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Walks argv once, splitting flags by scope and grouping on `--model`.
 *
 * - Global flags are collected into a single map (position-independent).
 * - `--model` opens a new group; group-scoped flags after it bind to that
 *   group. Group-scoped flags before the first `--model` seed `segments[0]`
 *   (the base/defaults inherited by every group).
 *
 * @returns `globalArgs` and `segments` where `segments[0]` is the base and
 *   `segments[1..]` are the explicit `--model` groups in order.
 */
function readGrouped(
  argv: string[],
  groupFlags: Set<string>
): { globalArgs: Map<string, string>; segments: Map<string, string>[] } {
  const globalArgs = new Map<string, string>();
  const segments: Map<string, string>[] = [new Map()];
  let current = 0; // index into segments; 0 = base

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    // Parse flag + value (supports --flag=value, --flag value, boolean --flag).
    let flag = arg;
    let value: string;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        value = "true";
      } else {
        value = next;
        i++;
      }
    }

    if (flag === MODEL_FLAG) {
      segments.push(new Map());
      current = segments.length - 1;
      segments[current].set(flag, value);
    } else if (groupFlags.has(flag)) {
      segments[current].set(flag, value);
    } else {
      globalArgs.set(flag, value); // global (or unknown — harmlessly ignored later)
    }
  }

  return { globalArgs, segments };
}

/**
 * Resolves a field from env + an ordered list of arg maps (later maps win).
 * Falls back to the field default when no source provides it.
 */
function resolveField(
  field: ConfigField<unknown>,
  env: NodeJS.ProcessEnv,
  ...maps: (Map<string, string> | undefined)[]
): unknown {
  let raw: string | undefined;
  if (field.env && env[field.env] !== undefined) raw = env[field.env];
  for (const m of maps) {
    if (field.flag && m?.has(field.flag)) raw = m.get(field.flag);
  }
  return raw !== undefined ? (field.parse ? field.parse(raw) : raw) : field.default;
}

/**
 * Builds the simulator options from environment + CLI arguments.
 *
 * Supports **grouped flags**: each `--model <name|path>` opens a device group;
 * group-scoped flags bind to the current group (or seed the base before the
 * first `--model`); global flags apply fleet-wide. With no `--model`, a
 * single implicit group is produced (back-compatible with `--count`).
 *
 * Identity templating (`{i}`) is left raw here — each device stamps its own
 * index at construction time.
 */
export function buildOptions(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): CwmpSimulatorOptions {
  const globalFields = configFields.filter((f) => (f.scope ?? "global") === "global");
  const groupFields = configFields.filter((f) => f.scope === "group");
  const groupFlags = new Set(groupFields.map((f) => f.flag).filter(Boolean) as string[]);

  const { globalArgs, segments } = readGrouped(argv, groupFlags);
  const base = segments[0];

  // Base options: global fields (any position) + group fields resolved from the
  // base segment. `options.device` / `options.fleet.count` act as the defaults
  // inherited by every group and back the single-group fallback.
  const options: Record<string, any> = {};
  for (const field of globalFields) setPath(options, field.path, resolveField(field, env, globalArgs));
  for (const field of groupFields) setPath(options, field.path, resolveField(field, env, base));

  // Explicit groups: one per `--model` segment, inheriting base then overriding.
  const explicit = segments.slice(1);
  const groups: FleetGroup[] = explicit.map((seg) => {
    const tmp: Record<string, any> = {};
    for (const field of groupFields) setPath(tmp, field.path, resolveField(field, env, base, seg));
    return { count: tmp.fleet?.count ?? 1, device: tmp.device ?? {} };
  });

  // No `--model` → a single implicit group from the base options.
  options.fleet.groups =
    groups.length > 0 ? groups : [{ count: options.fleet.count ?? 1, device: options.device }];

  return options as CwmpSimulatorOptions;
}
