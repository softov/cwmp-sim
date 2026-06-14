/**
 * Test script for TR-069 Download and Upload Diagnostics
 *
 * This script demonstrates how to trigger diagnostics on a simulated device.
 * Run with: npx tsx test/test-diagnostics.ts
 */

import CWMPDevice from "../src/cwmp-device.ts";

async function testDownloadDiagnostics() {
  console.log("\n=== Testing Download Diagnostics ===\n");

  const device = new CWMPDevice({
    serialNumber: "TEST123456",
    manufacturer: "BrByte",
    oui: "00256D",
    productClass: "TestDevice",
    rootName: "Device"
  });

  // Set download URL to a small test file
  const downloadUrl = "http://httpbin.org/bytes/1024"; // 1KB test file
  device.set("Device.IP.Diagnostics.DownloadDiagnostics.DownloadURL", downloadUrl);
  device.set("Device.IP.Diagnostics.DownloadDiagnostics.Timeout", "5000");

  // Trigger the diagnostic
  console.log(`Triggering download diagnostic for: ${downloadUrl}`);
  device.set("Device.IP.Diagnostics.DownloadDiagnostics.DiagnosticsState", "Requested");

  // Wait for completion
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Check results
  const state = device.getValue("Device.IP.Diagnostics.DownloadDiagnostics.DiagnosticsState");
  const totalBytesReceived = device.getValue("Device.IP.Diagnostics.DownloadDiagnostics.TotalBytesReceived");
  const testBytesReceived = device.getValue("Device.IP.Diagnostics.DownloadDiagnostics.TestBytesReceived");

  console.log("\nResults:");
  console.log(`  State: ${state}`);
  console.log(`  TotalBytesReceived: ${totalBytesReceived}`);
  console.log(`  TestBytesReceived: ${testBytesReceived}`);
}

async function testUploadDiagnostics() {
  console.log("\n=== Testing Upload Diagnostics ===\n");

  const device = new CWMPDevice({
    serialNumber: "TEST123456",
    manufacturer: "BrByte",
    oui: "00256D",
    productClass: "TestDevice",
    rootName: "Device"
  });

  // Set upload URL to httpbin echo service
  const uploadUrl = "http://httpbin.org/put";
  device.set("Device.IP.Diagnostics.UploadDiagnostics.UploadURL", uploadUrl);
  device.set("Device.IP.Diagnostics.UploadDiagnostics.TestFileLength", "2048"); // 2KB
  device.set("Device.IP.Diagnostics.UploadDiagnostics.Timeout", "5000");

  // Trigger the diagnostic
  console.log(`Triggering upload diagnostic for: ${uploadUrl}`);
  device.set("Device.IP.Diagnostics.UploadDiagnostics.DiagnosticsState", "Requested");

  // Wait for completion
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Check results
  const state = device.getValue("Device.IP.Diagnostics.UploadDiagnostics.DiagnosticsState");
  const totalBytesSent = device.getValue("Device.IP.Diagnostics.UploadDiagnostics.TotalBytesSent");
  const testBytesSent = device.getValue("Device.IP.Diagnostics.UploadDiagnostics.TestBytesSent");

  console.log("\nResults:");
  console.log(`  State: ${state}`);
  console.log(`  TotalBytesSent: ${totalBytesSent}`);
  console.log(`  TestBytesSent: ${testBytesSent}`);
}

async function main() {
  try {
    await testDownloadDiagnostics();
    await testUploadDiagnostics();
    console.log("\n✓ Tests completed\n");
  } catch (error) {
    console.error("\n✗ Test failed:", error);
    process.exit(1);
  }
}

main();
