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
  /** Name or path of a model to load (resolved by the config layer; `.csv`/`.json` path or a bare name under `modelsDir`). */
  modelName?: string;
  /** A pre-loaded device model (base parameter tree); set by the config layer. */
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
  /** Number of devices to simulate when no `groups` are given (default 1). */
  count?: number;
  /** Delay in ms between each device's boot, to stagger Informs (default 1000). */
  bootDelay?: number;
  /** Directory to resolve model names from (default `./models`). */
  modelsDir?: string;
  /** Fleet composition: one entry per device group (mixed types). When set, supersedes `count`. */
  groups?: FleetGroup[];
};

export type CwmpSimulatorOptions = {
  device: CwmpDeviceOptions;
  conn: CwmpConnOptions;
  acs: CwmpAcsOptions;
  log?: CwmpLogOptions;
  fleet?: CwmpFleetOptions;
};

