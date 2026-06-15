import type { CwmpSimulatorOptions } from "./types.ts";

export function buildOptions(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): CwmpSimulatorOptions {
  const options: CwmpSimulatorOptions = {
    device: {
      rootName: env["DEVICE_ROOT"] || "Device",
      serialNumber: env["DEVICE_SERIAL"] || "123456",
      oui: env["DEVICE_OUI"] || "000000",
      productClass: env["DEVICE_PRODUCT_CLASS"] || "Simulator",
      csvPath: env["DEVICE_CSV"] || "./models/data_model_test.csv",
      jsonPath: env["DEVICE_JSON"] || "./models/data_model_test.json",
    },
    acs: {
      url: env["ACS_URL"] || "http://localhost:7547/",
      user: env["ACS_USER"] || "",
      pass: env["ACS_PASS"] || "",
    },
    conn: {
      ssl: false,
      addr: env["CONN_ADDR"] || "0.0.0.0",
      port: parseInt(env["CONN_PORT"] || "7547"),
      user: env["CONN_USER"] || "",
      pass: env["CONN_PASS"] || "",
    },
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--acs" && argv[i + 1]) {
      options.acs.url = argv[++i];
    } else if (argv[i] === "--port" && argv[i + 1]) {
      options.conn.port = parseInt(argv[++i]);
    } else if (argv[i] === "--ip" && argv[i + 1]) {
      options.conn.addr = argv[++i];
    } else if (argv[i] === "--serial" && argv[i + 1]) {
      options.device.serialNumber = argv[++i];
    }
  }

  return options;
}
