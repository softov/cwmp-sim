import CWMPDevice from "../src/cwmp-device.js";
import models from "../src/cwmp-model.js";

console.log("Starting Verification...");

// 1. Instantiate InternetGatewayDevice (TR-098)
const config = { rootName: "InternetGatewayDevice" };
const device = new CWMPDevice(config);

console.log(`Root: ${Object.keys(device._rootTree)[0]}`);
if (Object.keys(device._rootTree)[0] !== "InternetGatewayDevice") {
  console.error("FAIL: Root is not InternetGatewayDevice");
  process.exit(1);
}

// 2. Setup Context for PortMapping
// Ensure PortMappingNumberOfEntries exists to test correlation
// TR-181 Path: Device.NAT.PortMapping.
// But our defaultTR181 only has DeviceInfo, ManagementServer, LANDevice.
// We need to stick to TR-098 for this test OR update test to add structure first.
// EASIEST: Switch config to InternetGatewayDevice to match original test intent.

// Switching back to InternetGatewayDevice for this test
// const config = { _type: "InternetGatewayDevice" };
// ... wait, the constructor default changed to "Device".
// But we passed { _type: "InternetGatewayDevice" } in line 8 of ORIGINAL test-model.js (see Step 258).
// Why did it fail?
// In Step 258: const config = { _type: "InternetGatewayDevice" };
// In Step 279 output: Root: Device.
// This implies `device._type` was "Device" despite config.
// Let's check constructor in cwmp-device.js again.

// 2. Setup Context for PortMapping
// Ensure PortMappingNumberOfEntries exists to test correlation
const connectionPath = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1";
const portMappingPath = connectionPath + ".PortMapping";
const node = device.findNode(portMappingPath);
if (!node) {
  console.log("FAIL: Node not found");
  process.exit(1);
}
const setStatus = device.set(connectionPath + ".PortMappingNumberOfEntries", "0");
console.log("SetStatus: " + setStatus);
// 3. Add PortMapping
console.log("Adding PortMapping...");
const [status, instance] = device.addObject(portMappingPath);

console.log(`AddObject Result - Status: ${status}, Instance: ${instance}`);

if (status !== 0) {
  console.error("FAIL: AddObject returned non-zero status");
}

if (instance !== 1) {
  console.error("FAIL: Instance number should be 1, got " + instance);
}

// 4. Verify NumberOfEntries
const numEntries = device.getValue(connectionPath + ".PortMappingNumberOfEntries");
console.log(`PortMappingNumberOfEntries: ${numEntries}`);

if (numEntries !== "1") {
  console.error("FAIL: NumberOfEntries not incremented");
}

// 5. Verify Child Exists
const mappingStatus = device.getValue(`${portMappingPath}.${instance}.PortMappingEnabled`);
console.log(`PortMapping.${instance}.PortMappingEnabled: ${mappingStatus}`);

if (mappingStatus !== "false") {
  // Default is false
  console.error("FAIL: PortMappingEnabled default value incorrect or node missing");
  console.log(device.findNode(`${portMappingPath}.${instance}.PortMappingEnabled`));
}

// 6. Delete PortMapping
console.log("Deleting PortMapping...");
const deleteStatus = device.deleteObject(portMappingPath + "." + instance);
console.log(`DeleteObject Result - Status: ${deleteStatus}`);

if (deleteStatus !== 0) {
  console.error("FAIL: DeleteObject returned non-zero status");
}

// 7. Verify NumberOfEntries Decremented
const numEntriesAfter = device.getValue(connectionPath + ".PortMappingNumberOfEntries");
console.log(`PortMappingNumberOfEntries (After Delete): ${numEntriesAfter}`);

if (numEntriesAfter !== "0") {
  console.error("FAIL: NumberOfEntries not decremented");
}

// 8. Verify Instance Gone
const instanceNodeAfter = device.findNode(portMappingPath + "." + instance);
if (instanceNodeAfter) {
  console.error("FAIL: Instance still exists after delete");
} else {
  console.log("Instance verified deleted.");
}
console.log("Verification Complete.");
