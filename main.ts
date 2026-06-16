#!/usr/bin/env node
import { buildOptions, printHelp, resolveModels } from "./src/config/index.ts";
import CWMPSimulator from "./src/cwmp-sim.ts";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(printHelp());
  process.exit(0);
}

const options = await resolveModels(buildOptions(process.env, argv));

const client = new CWMPSimulator(options);

client.start();

console.log("Simulator started. Values:");
console.log(`  ACS: ${options.acs.url}`);
console.log(`  CPE: ${options.conn.addr}:${options.conn.port}`);
const groups = options.fleet?.groups ?? [];
console.log(`  Fleet: ${client._devices.length} device(s) in ${groups.length || 1} group(s)`);
for (const g of groups) {
  const label = g.model ? `${g.device?.modelName} (root ${g.model.root})` : "default";
  console.log(`    - ${label} ×${g.count}`);
}

process.on("SIGINT", () => {
  console.log("\nStopping simulator...");
  client.stop();
  process.exit();
});
