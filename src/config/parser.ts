import type { CwmpSimulatorOptions } from "../types.ts";
import { configFields } from "./fields.ts";

function setPath(target: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

function readArgv(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith("--")) continue;

    const eq = arg.indexOf("=");

    if (eq !== -1) {
      values.set(arg.slice(0, eq), arg.slice(eq + 1));
      continue;
    }

    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      values.set(arg, "true");
      continue;
    }

    values.set(arg, next);
    i++;
  }

  return values;
}

export function buildOptions(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): CwmpSimulatorOptions {
  const args = readArgv(argv);
  const options: Record<string, any> = {};

  for (const field of configFields) {
    let raw: string | undefined;

    if (field.env && env[field.env] !== undefined) {
      raw = env[field.env];
    }

    if (field.flag && args.has(field.flag)) {
      raw = args.get(field.flag);
    }

    const value = raw !== undefined ? (field.parse ? field.parse(raw) : raw) : field.default;

    setPath(options, field.path, value);
  }

  return options as CwmpSimulatorOptions;
}
