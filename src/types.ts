import type { Logger, LogLevel, LoggerSink } from "./logger.ts";

/** Parsed model: the inferred root key (`Device` / `InternetGatewayDevice`) + the tree. */
export type LoadedModel = { root: string; tree: Record<string, any> };

/**
 * A device's persistable state — the writable parameter values it has accumulated
 * (e.g. what an ACS set), plus any SetParameterAttributes. Read-only/structural
 * params are not stored; they come deterministically from the model on reload.
 * Keyed by full parameter path. JSON-serializable.
 */
export type SavedState = {
  /** Writable leaf values keyed by full path (includes ManagementServer.ParameterKey, itself writable). */
  params: Record<string, { value: string; type: string }>;
  /** Persisted SetParameterAttributes (notification + access list) keyed by path. */
  attributes?: Record<string, { notification: number; accessList: string[] }>;
};

export type XmlNode = {
  name: string;
  namespace: string;
  localName: string;
  attrs: string;
  text: string;
  bodyIndex: number;
  children: XmlNode[]
};

export interface ISimulator {
  // send(xml: string): Promise<void>;
  // onError(err: Error): void;
}

export type CwmpNode = {
  _type: string;
  _writable: boolean;
  _value: string;
  // _children?: CwmpNode[];
  funcObj?: Function;
  funcSet?: Function;
  // [paramName: string]: CwmpNode;
};

export type CwmpConnOptions = {
  ssl?: boolean;
  port?: number;
  addr?: string;
  user?: string;
  pass?: string;
  authMode?: string;
};

export type CwmpAcsOptions = {
  url: string;
  user?: string;
  pass?: string;
};

export type CwmpDeviceOptions = {
  manufacturer?: string;
  rootName?: string;
  oui?: string;
  productClass?: string;
  serialNumber?: string;
  mac?: string;
  index?: number;
  logger?: Logger;
  /** A pre-loaded device model (base parameter tree). Resolved objects only — the library reads no files. */
  model?: LoadedModel;
};

export type CwmpLogOptions = {
  /** Verbosity threshold. Omitted → silent (library default). */
  level?: LogLevel;
  /** Bring-your-own logger (e.g. pino/winston); used as-is when provided. */
  logger?: Logger;
  /** Prepended to every message (e.g. a device serial). */
  prefix?: string;
  /** Low-level emitter override for the built-in logger. */
  sink?: LoggerSink;
};

/**
 * One device group in a fleet composition: a model (device type) replicated
 * `count` times, with its own effective device options. Built from a
 * `--model <name|path> …group flags…` segment on the CLI.
 */
export type FleetGroup = {
  /** Number of devices in this group (default 1). */
  count: number;
  /** Full effective device options for the group (base defaults + group overrides). */
  device: CwmpDeviceOptions;
  /** Resolved model tree (set by the config layer); undefined → built-in default tree. */
  model?: LoadedModel;
};

export type CwmpFleetOptions = {
  /** Delay in ms between each device's boot, to stagger Informs (default 1000). */
  bootDelay?: number;
  /** Base identity index — the global `{i}` counter starts here (default 0). */
  index?: number;
  /**
   * Fleet composition: one entry per device group (mixed types). Empty/omitted →
   * a single default device (one group, built-in model, no file).
   */
  groups?: FleetGroup[];
};

/**
 * The simulator runs a **fleet** — there is no standalone "device" option; a
 * single device is simply a fleet of one default group. Device-type options live
 * inside each `fleet.groups[].device`.
 */
export type CwmpSimulatorOptions = {
  conn: CwmpConnOptions;
  acs: CwmpAcsOptions;
  log?: CwmpLogOptions;
  fleet?: CwmpFleetOptions;
  /**
   * Optional state source: given a device's serial, returns its saved state to
   * apply at boot (before the first Inform). The simulator stays I/O-free — the
   * caller (CLI) does any file reads. The counterpart to the `device:save` event.
   */
  loadState?: (serial: string) => SavedState | undefined;
};

