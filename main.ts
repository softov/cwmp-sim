#!/usr/bin/env node
import { buildOptions, printHelp } from "./src/config/index.ts";
import CWMPSimulator from "./src/cwmp-sim.ts";
import { resolveFleet } from "./models.ts";
import { resolveStorageDir, readState, writeState } from "./storage.ts";
import type { CwmpSimulatorOptions } from "./src/types.ts";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(printHelp());
  process.exit(0);
}

// config: parse CLI options (pure, no files). binary: read the model files
// (resolveFleet) + storage dir, then compose the library options.
const cli = buildOptions(process.env, argv);
const storageDir = resolveStorageDir(cli.storageDir);

const options: CwmpSimulatorOptions = {
  conn: cli.conn,
  acs: cli.acs,
  log: cli.log,
  fleet: resolveFleet(cli.fleet),
  // Restore each device's saved state at boot (pull); the library does no I/O.
  loadState: (serial) => readState(storageDir, serial),
};

const client = new CWMPSimulator(options);

// Persist on save (push) — emitted after each session (when dirty) and on stop.
client.on("device:save", (device, state) => writeState(storageDir, device._serialNumber, state));

client.start();

console.log("Simulator started. Values:");
console.log(`  ACS: ${options.acs.url}`);
console.log(`  CPE: ${options.conn.addr}:${options.conn.port}`);
console.log(`  Storage: ${storageDir}`);
const groups = cli.fleet?.groups ?? [];
console.log(`  Fleet: ${client._devices.length} device(s) in ${groups.length || 1} group(s)`);
for (const g of groups) {
  const name = g.device?.modelName;
  const label = name && name.toLowerCase() !== "default" ? name : "default";
  console.log(`    - ${label} ×${g.count}`);
}

process.on("SIGINT", () => {
  console.log("\nStopping simulator...");
  client.stop();
  process.exit();
});
