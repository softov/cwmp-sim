#!/usr/bin/env node
"use strict";

// import cluster from 'cluster';
import { default as CWMPSimulator } from './src/cwmp-sim.ts';
import type { CwmpSimulatorOptions } from './src/types.d.ts';

// cli options
let options = {
  device: {
    rootName: process.env['DEVICE_ROOT'] || 'Device',
    serialNumber: process.env['DEVICE_SERIAL'] || '123456',
    oui: process.env['DEVICE_OUI'] || "000000",
    productClass: process.env['DEVICE_PRODUCT_CLASS'] || "Simulator",
    csvPath: process.env['DEVICE_CSV'] || './models/data_model_test.csv',
    jsonPath: process.env['DEVICE_JSON'] || './models/data_model_test.json',
  },

  acs: {
    url: process.env['ACS_URL'] || 'http://localhost:7547/',
    user: process.env['ACS_USER'] || '',
    pass: process.env['ACS_PASS'] || '',
  },
  conn: {
    ssl: false,
    addr: process.env['CONN_ADDR'] || '0.0.0.0',
    port: parseInt(process.env['CONN_PORT'] || '7547'),
    user: process.env['CONN_USER'] || '',
    pass: process.env['CONN_PASS'] || ''
  }
} as CwmpSimulatorOptions;

// Simple Arg Parser
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--acs" && args[i + 1]) {
    options.acs.url = args[i + 1];
    i++;
  } else if (args[i] === "--port" && args[i + 1]) {
    options.conn.port = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === "--ip" && args[i + 1]) {
    options.conn.addr = args[i + 1];
    i++;
  } else if (args[i] === "--serial" && args[i + 1]) {
    options.device.serialNumber = args[i + 1];
    i++;
  }
}

// Just one client for now, easy to extend to loop
const client = new CWMPSimulator(options);

client.start();

console.log("Simulator started. Values:");
console.log(`  ACS: ${options.acs.url}`);
console.log(`  CPE: ${options.conn.addr}:${options.conn.port}`);
console.log(`  Serial: ${options.device.serialNumber}`);
console.log(`  Type: ${options.device.productClass}`);
if (options.device.csvPath) console.log(`  CSV: ${options.device.csvPath}`);
if (options.device.jsonPath) console.log(`  JSON: ${options.device.jsonPath}`);

// Handle Exit to Save CSV
process.on('SIGINT', () => {
  console.log("\nStopping simulator...");
  if (client._device._csvPath) {
    client._device.exportCSV(client._device._csvPath);
  }
  process.exit();
});
