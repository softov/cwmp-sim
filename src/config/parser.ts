import { configFields, type ConfigField } from "./fields.ts";
import type { CliOptions, CliFleetGroup } from "./types.ts";

const MODEL_FLAG = "--model";
// `--off <feature>` is repeatable (--off inform --off cr) so it can't ride the
// single-value field machinery — the parser accumulates it (comma-joined) per
// segment and buildOptions maps the resulting set onto device flags.
const OFF_FLAG = "--off";

/** Union of the `--off` features across the given segments (case-insensitive). */
function offSet(...maps: (Map<string, string> | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const m of maps) {
    const raw = m?.get(OFF_FLAG);
    if (raw) for (const f of raw.split(",")) if (f.trim()) set.add(f.trim().toLowerCase());
  }
  return set;
}

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
    } else if (flag === OFF_FLAG) {
      // Repeatable: accumulate comma-joined within the current segment.
      const seg = segments[current];
      const prev = seg.get(OFF_FLAG);
      seg.set(OFF_FLAG, prev ? `${prev},${value}` : value);
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
 * Parses environment + CLI arguments into a `CliOptions` — the CLI's own,
 * **unresolved** option shape (model *paths*, a storage dir; no files read).
 * The binary resolves the fleet (loads model files) via `resolveFleet` and
 * composes the library's `CwmpSimulatorOptions`.
 *
 * Supports **grouped flags**: each `--model <path>` opens a device group;
 * group-scoped flags bind to the current group (or seed the base before the
 * first `--model`); global flags apply fleet-wide. With no `--model`, a single
 * group is produced from the base (a default device).
 *
 * Identity templating (`{i}`) is left raw here — each device stamps its own
 * index at construction time.
 */
export function buildOptions(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): CliOptions {
  const globalFields = configFields.filter((f) => (f.scope ?? "global") === "global");
  const groupFields = configFields.filter((f) => f.scope === "group");
  const groupFlags = new Set(groupFields.map((f) => f.flag).filter(Boolean) as string[]);

  const { globalArgs, segments } = readGrouped(argv, groupFlags);
  const baseSeg = segments[0];

  // Global (non-group) options → the returned object (conn/acs/log/storageDir/fleet.{index,bootDelay}).
  const options: Record<string, any> = {};
  for (const field of globalFields) setPath(options, field.path, resolveField(field, env, globalArgs));

  // One group's effective options: base group-field values overlaid by the
  // segment's, plus the `--off` set (base ∪ group) mapped onto device flags.
  const groupOf = (seg?: Map<string, string>): CliFleetGroup => {
    const tmp: Record<string, any> = {};
    for (const field of groupFields) setPath(tmp, field.path, resolveField(field, env, baseSeg, seg));
    const device = tmp.device ?? {};
    const off = offSet(baseSeg, seg);
    device.noInform = off.has("inform");
    device.noCr = off.has("cr");
    return { count: tmp.fleet?.count ?? 1, device };
  };

  // Each `--model` segment is a group; with none, a single group from the base.
  const explicit = segments.slice(1);
  const groups: CliFleetGroup[] =
    explicit.length > 0 ? explicit.map((seg) => groupOf(seg)) : [groupOf(undefined)];

  options.fleet ??= {};
  options.fleet.groups = groups;

  return options as CliOptions;
}
