import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPDevice from "../src/cwmp-device.ts";

// TR-098 root keeps the paths short and the fixtures deterministic.
// No jsonPath is passed, so the constructor performs no file I/O.
function makeDevice() {
  return new CWMPDevice({ rootName: "InternetGatewayDevice", serialNumber: "SN-TEST" });
}

const SERIAL = "InternetGatewayDevice.DeviceInfo.SerialNumber"; // read-only
const PROVCODE = "InternetGatewayDevice.DeviceInfo.ProvisioningCode"; // writable
const SSID = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID"; // writable
const PM = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.PortMapping";
const PM_COUNT =
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.PortMappingNumberOfEntries";

test("getValue returns the configured default for a known leaf", () => {
  const d = makeDevice();
  assert.equal(d.getValue(SERIAL), "SN-TEST");
  assert.equal(d.getValue(SSID), "BrByte_WiFi");
});

test("getValue returns an empty string for an unknown path", () => {
  const d = makeDevice();
  assert.equal(d.getValue("InternetGatewayDevice.Nope.Missing"), "");
});

test("get returns a leaf node but null for containers and unknown paths", () => {
  const d = makeDevice();
  const leaf = d.get(SERIAL);
  assert.ok(leaf);
  assert.equal(leaf!._value, "SN-TEST");
  assert.equal(d.get("InternetGatewayDevice.DeviceInfo"), null); // container, no _value
  assert.equal(d.get("InternetGatewayDevice.Nope"), null);
});

test("set updates a writable leaf and reports success", () => {
  const d = makeDevice();
  assert.equal(d.set(PROVCODE, "PROV-123"), true);
  assert.equal(d.getValue(PROVCODE), "PROV-123");
});

test("set refuses a read-only leaf and leaves the value unchanged", () => {
  const d = makeDevice();
  assert.equal(d.set(SERIAL, "HACKED"), false);
  assert.equal(d.getValue(SERIAL), "SN-TEST");
});

test("set with force overrides read-only protection", () => {
  const d = makeDevice();
  assert.equal(d.set(SERIAL, "FORCED", true), true);
  assert.equal(d.getValue(SERIAL), "FORCED");
});

test("set on an unknown path fails without force and creates with force", () => {
  const d = makeDevice();
  assert.equal(d.set("InternetGatewayDevice.Custom.Thing", "v"), false);
  assert.equal(d.set("InternetGatewayDevice.Custom.Thing", "v", true), true);
  assert.equal(d.getValue("InternetGatewayDevice.Custom.Thing"), "v");
});

test("addObject creates a new instance and increments NumberOfEntries", () => {
  const d = makeDevice();
  assert.equal(d.getValue(PM_COUNT), "0");

  const [status, instance] = d.addObject(PM + ".");
  assert.equal(status, 0);
  assert.equal(instance, 1);
  assert.equal(d.getValue(PM_COUNT), "1");
  // funcObj populated the instance with the default port-mapping params.
  assert.equal(d.getValue(`${PM}.1.ExternalPort`), "0");
});

test("deleteObject removes an instance and decrements NumberOfEntries", () => {
  const d = makeDevice();
  d.addObject(PM + ".");
  assert.equal(d.getValue(PM_COUNT), "1");

  assert.equal(d.deleteObject(`${PM}.1`), 0);
  assert.equal(d.getValue(PM_COUNT), "0");
  assert.equal(d.get(`${PM}.1`), null);
});

test("addObject rejects an unknown parent path", () => {
  const d = makeDevice();
  assert.deepEqual(d.addObject("InternetGatewayDevice.NoSuch."), [9005, 0]);
  assert.deepEqual(d.addObject(null), [9005, 0]);
});

test("deleteObject rejects a missing instance", () => {
  const d = makeDevice();
  assert.equal(d.deleteObject(`${PM}.99`), 1);
  assert.equal(d.deleteObject(null), 1);
});

test("getParameterNames returns a single entry for a leaf path", () => {
  const d = makeDevice();
  const names = d.getParameterNames(SERIAL, false);
  assert.deepEqual(names, [{ name: SERIAL, writable: false }]);
});

test("getParameterNames lists immediate children at the next level", () => {
  const d = makeDevice();
  const names = d.getParameterNames("InternetGatewayDevice.DeviceInfo", true);
  const serial = names.find((n: any) => n.name === SERIAL);
  assert.ok(serial, "expected SerialNumber among DeviceInfo children");
  assert.equal(serial.writable, false);
});

test("set fires a change listener with the new value", () => {
  const d = makeDevice();
  let received: string | null = null;
  d.addListener(PROVCODE, (val: string) => { received = val; });
  d.set(PROVCODE, "NOTIFY");
  assert.equal(received, "NOTIFY");
});

const MS = "InternetGatewayDevice.ManagementServer";

test("configureManagementServer writes ACS + CR config into the model", () => {
  const d = makeDevice();
  d.configureManagementServer({ acsUrl: "http://acs/x", acsUser: "u", acsPass: "p", crUser: "cru", crPass: "crp" });
  assert.equal(d.getValue(`${MS}.URL`), "http://acs/x");
  assert.equal(d.getValue(`${MS}.Username`), "u");
  assert.equal(d.getValue(`${MS}.Password`), "p");
  assert.deepEqual(d.getCrCredentials(), { user: "cru", pass: "crp" });
});

test("configureManagementServer leaves omitted fields untouched", () => {
  const d = makeDevice();
  d.configureManagementServer({ acsUrl: "http://acs/x" });
  assert.equal(d.getValue(`${MS}.URL`), "http://acs/x");
  // ConnectionRequestUsername not provided → stays at its default (empty).
  assert.equal(d.getCrCredentials().user, "");
});

test("setConnectionRequestURL updates the CR URL leaf", () => {
  const d = makeDevice();
  d.setConnectionRequestURL("http://host:7547/abc123");
  assert.equal(d.getValue(`${MS}.ConnectionRequestURL`), "http://host:7547/abc123");
});

test("device resolves {i} identity templates from its own index", () => {
  const d = new CWMPDevice({ rootName: "Device", serialNumber: "SIM-{i}", oui: "00E0{i:02x}", index: 5 });
  assert.equal(d.getValue("Device.DeviceInfo.SerialNumber"), "SIM-5");
  assert.equal(d.getValue("Device.DeviceInfo.ManufacturerOUI"), "00E005");
});

test("device defaults index to 0 when not provided", () => {
  const d = new CWMPDevice({ rootName: "Device", serialNumber: "dev-{i:03}" });
  assert.equal(d.getValue("Device.DeviceInfo.SerialNumber"), "dev-000");
});
