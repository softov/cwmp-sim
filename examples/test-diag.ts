/**
 * Manual test script for TR-069 IP Ping and TraceRoute diagnostics.
 *
 * Diagnostics are triggered by setting the matching `DiagnosticsState` parameter
 * to "Requested"; the device runs the real system `ping`/`traceroute` command and
 * writes the results back into the data model.
 *
 * This performs real network + child-process I/O, so it is a manual script (not a
 * `*.test.ts` unit test) and is excluded from `npm test`.
 *
 * Run with: npx tsx examples/test-diag.ts
 */

import CWMPDevice from "../src/cwmp-device.ts";

const PING = "Device.IP.Diagnostics.IPPing";
const TRACE = "Device.IP.Diagnostics.TraceRoute";

function makeDevice() {
  return new CWMPDevice({
    serialNumber: "TEST123456",
    manufacturer: "BrByte",
    oui: "00256D",
    productClass: "TestDevice",
    rootName: "Device",
  });
}

async function testPing() {
  console.log("\n=== Testing IP Ping Diagnostics ===\n");
  const device = makeDevice();

  device.set(`${PING}.Host`, "8.8.8.8");
  device.set(`${PING}.NumberOfRepetitions`, "4");
  device.set(`${PING}.Timeout`, "1000");
  device.set(`${PING}.DataBlockSize`, "32");

  console.log("Triggering ping diagnostic for: 8.8.8.8");
  device.set(`${PING}.DiagnosticsState`, "Requested");

  await new Promise((resolve) => setTimeout(resolve, 10000));

  console.log("\nResults:");
  console.log(`  State: ${device.getValue(`${PING}.DiagnosticsState`)}`);
  console.log(`  SuccessCount: ${device.getValue(`${PING}.SuccessCount`)}`);
  console.log(`  FailureCount: ${device.getValue(`${PING}.FailureCount`)}`);
  console.log(`  AverageResponseTime: ${device.getValue(`${PING}.AverageResponseTime`)}`);
}

async function testTraceroute() {
  console.log("\n=== Testing TraceRoute Diagnostics ===\n");
  const device = makeDevice();

  device.set(`${TRACE}.Host`, "8.8.8.8");
  device.set(`${TRACE}.MaxHopCount`, "15"); // short for the test
  device.set(`${TRACE}.Timeout`, "1000");

  console.log("Triggering traceroute diagnostic for: 8.8.8.8");
  device.set(`${TRACE}.DiagnosticsState`, "Requested");

  await new Promise((resolve) => setTimeout(resolve, 20000));

  console.log("\nResults:");
  console.log(`  State: ${device.getValue(`${TRACE}.DiagnosticsState`)}`);
  console.log(`  RouteHopsNumberOfEntries: ${device.getValue(`${TRACE}.RouteHopsNumberOfEntries`)}`);
  console.log(`  ResponseTime: ${device.getValue(`${TRACE}.ResponseTime`)}`);
}

async function main() {
  try {
    await testPing();
    await testTraceroute();
    console.log("\n✓ Tests completed\n");
  } catch (error) {
    console.error("\n✗ Test failed:", error);
    process.exit(1);
  }
}

main();

