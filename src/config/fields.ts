import { LOG_LEVELS, type LogLevel } from "../logger.ts";

export type ConfigField<T> = {
  path: string;
  env?: string;
  flag?: string;
  label: string;
  description?: string;
  default: T;
  parse?: (value: string) => T;
  format?: (value: T) => string;
  /**
   * Where the flag applies in a grouped fleet. `"group"` flags bind to the
   * current `--model` group (and seed the base before the first one);
   * `"global"` flags (the default) apply fleet-wide regardless of position.
   */
  scope?: "global" | "group";
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
    path: "device.modelName",
    env: "DEVICE_MODEL",
    flag: "--model",
    label: "Model name or path (opens a device group); a .csv/.json path or a name under the models dir. Omit / 'default' = built-in tree",
    default: "",
    parse: asString,
    scope: "group"
  },
  {
    path: "device.rootName",
    env: "DEVICE_ROOT",
    flag: "--device-root",
    label: "Device root name",
    default: "Device",
    parse: asString,
    scope: "group"
  },
  {
    path: "device.manufacturer",
    env: "DEVICE_MANUFACTURER",
    flag: "--manufacturer",
    label: "Device manufacturer",
    default: "Simulator",
    parse: asString,
    scope: "group"
  },
  {
    path: "device.serialNumber",
    env: "DEVICE_SERIAL",
    flag: "--serial",
    label: "Device serial number",
    default: "123456",
    parse: asString,
    scope: "group"
  },
  {
    path: "device.oui",
    env: "DEVICE_OUI",
    flag: "--oui",
    label: "Device OUI",
    default: "000000",
    parse: asString,
    scope: "group"
  },
  {
    path: "device.productClass",
    env: "DEVICE_PRODUCT_CLASS",
    flag: "--product-class",
    label: "Device product class",
    default: "Simulator",
    parse: asString,
    scope: "group"
  },
  {
    path: "device.index",
    env: "DEVICE_INDEX",
    flag: "--index",
    label: "Fleet base index (resolves {i} in serial/oui/mac; increments across all devices)",
    default: 0,
    parse: asInt
  },
  {
    path: "device.mac",
    env: "DEVICE_MAC",
    flag: "--mac",
    label: "Device MAC address (templatable; injected into the data model)",
    default: "",
    parse: asString,
    scope: "group"
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
  },

  {
    path: "fleet.count",
    env: "FLEET_COUNT",
    flag: "--count",
    label: "Number of devices in the current group (per --model)",
    default: 1,
    parse: asInt,
    scope: "group"
  },
  {
    path: "fleet.bootDelay",
    env: "FLEET_BOOT_DELAY",
    flag: "--boot-delay",
    label: "Delay (ms) between device boots",
    default: 1000,
    parse: asInt
  },
  {
    path: "fleet.modelsDir",
    env: "MODELS_DIR",
    flag: "--models-dir",
    label: "Directory to resolve model names from",
    default: "./models",
    parse: asString
  }
] satisfies ConfigField<unknown>[];
