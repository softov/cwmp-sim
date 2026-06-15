#!/usr/bin/env node
import { buildOptions, printHelp } from "./src/config/index.ts";
import CWMPSimulator from "./src/cwmp-sim.ts";
// import { buildOptions } from "./src/config.ts";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(printHelp());
  process.exit(0);
}

const options = buildOptions(process.env, argv);

const client = new CWMPSimulator(options);

client.start();

console.log("Simulator started. Values:");
console.log(`  ACS: ${options.acs.url}`);
console.log(`  CPE: ${options.conn.addr}:${options.conn.port}`);
console.log(`  Serial: ${options.device.serialNumber}`);
console.log(`  Type: ${options.device.productClass}`);
if (options.device.csvPath) console.log(`  CSV: ${options.device.csvPath}`);
if (options.device.jsonPath) console.log(`  JSON: ${options.device.jsonPath}`);

process.on("SIGINT", () => {
  console.log("\nStopping simulator...");
  if (client._device._csvPath) {
    client._device.exportCSV(client._device._csvPath);
  }
  process.exit();
});
