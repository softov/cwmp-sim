import type { CwmpSimulatorOptions } from "../types.ts";
import { LOG_LEVELS, type LogLevel } from "../logger.ts";

type ConfigSource = {
  env: NodeJS.ProcessEnv;
  argv: string[];
};

type ConfigField<T> = {
  path: string;
  env?: string;
  flag?: string;
  label: string;
  description?: string;
  default: T;
  parse?: (value: string) => T;
  format?: (value: T) => string;
};

const asBool = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(`Invalid boolean value: ${value}`);
};

const asInt = (value: string): number => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number value: ${value}`);
  }

  return parsed;
};

const asString = (value: string): string => value;

const asLogLevel = (value: string): LogLevel => {
  const normalized = value.trim().toLowerCase();

  if ((LOG_LEVELS as string[]).includes(normalized)) return normalized as LogLevel;

  throw new Error(`Invalid log level: ${value} (expected ${LOG_LEVELS.join("|")})`);
};

export const configFields: ConfigField<unknown>[] = [
  {
    path: "device.rootName",
    env: "DEVICE_ROOT",
    flag: "--device-root",
    label: "Device root name",
    default: "Device",
    parse: asString
  },
  {
    path: "device.manufacturer",
    env: "DEVICE_MANUFACTURER",
    flag: "--manufacturer",
    label: "Device manufacturer",
    default: "Simulator",
    parse: asString
  },
  {
    path: "device.serialNumber",
    env: "DEVICE_SERIAL",
    flag: "--serial",
    label: "Device serial number",
    default: "123456",
    parse: asString
  },
  {
    path: "device.oui",
    env: "DEVICE_OUI",
    flag: "--oui",
    label: "Device OUI",
    default: "000000",
    parse: asString
  },
  {
    path: "device.productClass",
    env: "DEVICE_PRODUCT_CLASS",
    flag: "--product-class",
    label: "Device product class",
    default: "Simulator",
    parse: asString
  },
  {
    path: "device.csvPath",
    env: "DEVICE_CSV",
    flag: "--csv",
    label: "Data model CSV path",
    default: "./models/data_model_test.csv",
    parse: asString
  },
  {
    path: "device.jsonPath",
    env: "DEVICE_JSON",
    flag: "--json",
    label: "Data model JSON path",
    default: "./models/data_model_test.json",
    parse: asString
  },

  {
    path: "acs.url",
    env: "ACS_URL",
    flag: "--acs",
    label: "ACS URL",
    default: "http://localhost:7547/",
    parse: asString
  },
  {
    path: "acs.user",
    env: "ACS_USER",
    flag: "--acs-user",
    label: "ACS username",
    default: "",
    parse: asString
  },
  {
    path: "acs.pass",
    env: "ACS_PASS",
    flag: "--acs-pass",
    label: "ACS password",
    default: "",
    parse: asString
  },

  {
    path: "conn.ssl",
    env: "CONN_SSL",
    flag: "--conn-ssl",
    label: "Enable connection request HTTPS",
    default: false,
    parse: asBool
  },
  {
    path: "conn.addr",
    env: "CONN_ADDR",
    flag: "--ip",
    label: "Connection request bind address",
    default: "0.0.0.0",
    parse: asString
  },
  {
    path: "conn.port",
    env: "CONN_PORT",
    flag: "--port",
    label: "Connection request bind port",
    default: 7547,
    parse: asInt
  },
  {
    path: "conn.user",
    env: "CONN_USER",
    flag: "--conn-user",
    label: "Connection request username",
    default: "",
    parse: asString
  },
  {
    path: "conn.pass",
    env: "CONN_PASS",
    flag: "--conn-pass",
    label: "Connection request password",
    default: "",
    parse: asString
  },
  {
    path: "conn.authMode",
    env: "CONN_AUTH_MODE",
    flag: "--conn-auth",
    label: "Connection request auth mode",
    default: "none",
    parse: asString
  },

  {
    path: "log.level",
    env: "LOG_LEVEL",
    flag: "--log-level",
    label: "Log level (silent|error|warn|info|debug|trace)",
    default: "info",
    parse: asLogLevel
  }
] satisfies ConfigField<unknown>[];
