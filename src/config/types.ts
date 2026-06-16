import type { CwmpConnOptions, CwmpAcsOptions, CwmpLogOptions } from "../types.ts";

// The CLI's own option shape — what `buildOptions(argv, env)` produces. It holds
// raw, unresolved CLI inputs (model *names*/paths, a storage dir — strings); it
// reads no files. The binary turns this into a fully-resolved
// `CwmpSimulatorOptions` (model *objects*) via `toSimulatorOptions`.

/** Device-type CLI inputs for one group (or the base). `modelName` is unresolved. */
export type CliDeviceOptions = {
  manufacturer?: string;
  rootName?: string;
  oui?: string;
  productClass?: string;
  serialNumber?: string;
  mac?: string;
  index?: number;
  /** Model name or path to load (resolved to a `LoadedModel` by the binary). */
  modelName?: string;
};

/** One `--model … <group flags>` segment as parsed from the CLI. */
export type CliFleetGroup = {
  count: number;
  device: CliDeviceOptions;
};

/** The parsed-but-unresolved CLI configuration. */
export type CliOptions = {
  device: CliDeviceOptions;
  conn: CwmpConnOptions;
  acs: CwmpAcsOptions;
  log?: CwmpLogOptions;
  fleet?: {
    count?: number;
    bootDelay?: number;
    /** Directory to resolve model names from (default `./models`). */
    modelsDir?: string;
    groups?: CliFleetGroup[];
  };
  /** Directory for per-device state files (the binary reads/writes here). */
  storageDir?: string;
};
