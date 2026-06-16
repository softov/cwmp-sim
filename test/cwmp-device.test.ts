import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPDevice, { hashConnectionPath } from "../src/cwmp-device.ts";

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

test("hashConnectionPath is deterministic, 8 hex chars, serial-distinct", () => {
  assert.equal(hashConnectionPath("SIM-1"), hashConnectionPath("SIM-1"));
  assert.match(hashConnectionPath("SIM-1"), /^[0-9a-f]{8}$/);
  assert.notEqual(hashConnectionPath("SIM-1"), hashConnectionPath("SIM-2"));
});

test("getConnectionHash matches the serial's hash and is cached", () => {
  const d = new CWMPDevice({ rootName: "Device", serialNumber: "SIM-{i}", index: 9 });
  assert.equal(d.getConnectionHash(), hashConnectionPath("SIM-9"));
  assert.equal(d.getConnectionHash(), d.getConnectionHash()); // stable / cached
});

// --- Device templates (fleet/02 Phase 2) ---

// A deliberately minimal template: DeviceInfo + one WLAN leaf, no
// ManagementServer and no diagnostics — those must be injected from defaults.
function partialTr181Model() {
  return {
    root: "Device",
    tree: {
      Device: {
        _writable: false,
        DeviceInfo: {
          SerialNumber: { _value: "TPL-SERIAL", _type: "xsd:string", _writable: false },
          ProductClass: { _value: "FromTemplate", _type: "xsd:string", _writable: false },
        },
        WiFi: {
          Radio: { "1": { Channel: { _value: "11", _type: "xsd:unsignedInt", _writable: true } } },
        },
      },
    },
  };
}

test("a template becomes the device's base tree, its root inferred", () => {
  const d = new CWMPDevice({ model: partialTr181Model(), serialNumber: "SIM-{i}", index: 1 });
  assert.equal(d._rootName, "Device");
  // template-only data survives
  assert.equal(d.getValue("Device.WiFi.Radio.1.Channel"), "11");
  assert.equal(d.getValue("Device.DeviceInfo.ProductClass"), "FromTemplate");
});

test("ensureRequiredNodes injects ManagementServer + diagnostics a template omits", () => {
  const d = new CWMPDevice({ model: partialTr181Model(), serialNumber: "S1" });
  // ManagementServer backfilled (a leaf the CR machinery relies on exists)
  assert.ok(d.findNode("Device.ManagementServer.ConnectionRequestURL"));
  // TR-181 diagnostics backfilled
  assert.equal(d.getValue("Device.IP.Diagnostics.IPPing.DiagnosticsState"), "None");
  assert.ok(d.findNode("Device.IP.Diagnostics.DownloadDiagnostics.DiagnosticsState"));
});

test("identity overlays the template's own DeviceInfo values", () => {
  const d = new CWMPDevice({ model: partialTr181Model(), serialNumber: "SIM-{i}", oui: "00E0{i:02x}", index: 7 });
  // template shipped TPL-SERIAL; the {i} identity wins
  assert.equal(d.getValue("Device.DeviceInfo.SerialNumber"), "SIM-7");
  assert.equal(d.getValue("Device.DeviceInfo.ManufacturerOUI"), "00E007");
});

test("a templated device still accepts ACS/CR config via configureManagementServer", () => {
  const d = new CWMPDevice({ model: partialTr181Model(), serialNumber: "S1" });
  d.configureManagementServer({ acsUrl: "http://acs/y", crUser: "cru", crPass: "crp" });
  assert.equal(d.getValue("Device.ManagementServer.URL"), "http://acs/y");
  assert.deepEqual(d.getCrCredentials(), { user: "cru", pass: "crp" });
});

test("a shared template object is not mutated across devices (deep-cloned)", () => {
  const tpl = partialTr181Model();
  const a = new CWMPDevice({ model: tpl, serialNumber: "A" });
  const b = new CWMPDevice({ model: tpl, serialNumber: "B" });
  assert.equal(a.getValue("Device.DeviceInfo.SerialNumber"), "A");
  assert.equal(b.getValue("Device.DeviceInfo.SerialNumber"), "B");
  // the source template object is untouched by either device's identity overlay
  assert.equal(tpl.tree.Device.DeviceInfo.SerialNumber._value, "TPL-SERIAL");
});

test("interval option sets the periodic-inform interval (ms)", () => {
  const d = new CWMPDevice({ rootName: "Device", serialNumber: "S1", interval: 60000 });
  assert.equal(d._periodicInformInterval, 60000);
  // 0/undefined keeps the built-in default
  assert.equal(new CWMPDevice({ rootName: "Device", serialNumber: "S2" })._periodicInformInterval, 300000);
});

test("noInform makes setPeriodicInform a no-op (no periodic timer scheduled)", () => {
  const d = new CWMPDevice({ rootName: "Device", serialNumber: "S1", noInform: true });
  assert.equal(d._noPeriodicInform, true);
  d.setPeriodicInform();
  assert.equal(d._periodicInformTimeout, null);
  // a normal device DOES schedule one
  const n = new CWMPDevice({ rootName: "Device", serialNumber: "S2" });
  n.setPeriodicInform();
  assert.notEqual(n._periodicInformTimeout, null);
  clearTimeout(n._periodicInformTimeout);
});

test("noCr option is carried onto the device", () => {
  assert.equal(new CWMPDevice({ rootName: "Device", serialNumber: "S1", noCr: true })._noConnectRequest, true);
  assert.equal(new CWMPDevice({ rootName: "Device", serialNumber: "S2" })._noConnectRequest, false);
});
