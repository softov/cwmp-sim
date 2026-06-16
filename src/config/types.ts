import type { CwmpConnOptions, CwmpAcsOptions, CwmpLogOptions } from "../types.ts";

// The CLI's own option shape — what `buildOptions(argv, env)` produces. It holds
// raw, unresolved CLI inputs (model *path* strings, a storage dir); it reads no
// files. The binary resolves the fleet (loads model files) via `resolveFleet`
// and composes the library's `CwmpSimulatorOptions`.

/** Device-type CLI inputs for one group. `modelName` is an unresolved file path. */
export type CliDeviceOptions = {
  manufacturer?: string;
  rootName?: string;
  oui?: string;
  productClass?: string;
  serialNumber?: string;
  mac?: string;
  /** Periodic-inform interval in **milliseconds** (`--interval` takes seconds and ×1000s into here). */
  interval?: number;
  /** `--off inform` — suppress periodic informs. */
  noInform?: boolean;
  /** `--off cr` — don't register/advertise the Connection-Request route. */
  noCr?: boolean;
  /** Path to a `.csv`/`.json` model file (resolved to a `LoadedModel` by the binary). */
  modelName?: string;
};

/** One `--model … <group flags>` segment as parsed from the CLI. */
export type CliFleetGroup = {
  count: number;
  device: CliDeviceOptions;
};

/** The fleet as parsed from the CLI (model paths unresolved). */
export type CliFleet = {
  bootDelay?: number;
  index?: number;
  groups?: CliFleetGroup[];
};

/**
 * The parsed-but-unresolved CLI configuration. Like the library, it's all
 * **fleet** — there is no standalone `device`; a single device is one group.
 */
export type CliOptions = {
  conn: CwmpConnOptions;
  acs: CwmpAcsOptions;
  log?: CwmpLogOptions;
  fleet?: CliFleet;
  /** Directory for per-device state files (the binary reads/writes here). */
  storageDir?: string;
  /** Enable the web dashboard (binary-side HTTP server). */
  dashboard?: boolean;
  /** Dashboard port (default 8080). */
  dashboardPort?: number;
  /** Dashboard bind host (default 127.0.0.1). */
  dashboardHost?: string;
};
