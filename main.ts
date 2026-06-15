#!/usr/bin/env node
import CWMPSimulator from "./src/cwmp-sim.ts";
import { buildOptions } from "./src/config.ts";

const options = buildOptions();
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
