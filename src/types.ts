import type { Logger, LogLevel, LoggerSink } from "./logger.ts";

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
  csvPath?: string;
  jsonPath?: string;
  mac?: string;
  index?: number;
  logger?: Logger;
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

export type CwmpSimulatorOptions = {
  device: CwmpDeviceOptions;
  conn: CwmpConnOptions;
  acs: CwmpAcsOptions;
  log?: CwmpLogOptions;
};

