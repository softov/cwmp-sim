import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPDevice from "../src/cwmp-device.ts";
import type { SavedState } from "../src/types.ts";

function makeDevice() {
  return new CWMPDevice({ rootName: "InternetGatewayDevice", serialNumber: "SN-1" });
}

const PROVCODE = "InternetGatewayDevice.DeviceInfo.ProvisioningCode"; // writable
const SERIAL = "InternetGatewayDevice.DeviceInfo.SerialNumber"; // read-only
const SSID = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID"; // writable

// --- exportState ---

test("exportState captures writable leaves and omits read-only ones", () => {
  const d = makeDevice();
  d.set(PROVCODE, "PROV-9");
  const state = d.exportState();

  assert.equal(state.params[PROVCODE].value, "PROV-9");
  assert.equal(state.params[PROVCODE].type, "xsd:string");
  // read-only SerialNumber is not part of persistable state
  assert.equal(state.params[SERIAL], undefined);
  // a known writable leaf is present at its model default
  assert.equal(state.params[SSID].value, "BrByte_WiFi");
});

test("exportState includes SetParameterAttributes when present", () => {
  const d = makeDevice();
  d._parameterAttributes.set(PROVCODE, { notification: 2, accessList: ["Subscriber"] });
  const state = d.exportState();
  assert.deepEqual(state.attributes?.[PROVCODE], { notification: 2, accessList: ["Subscriber"] });
});

test("exportState omits the attributes key when there are none", () => {
  const state = makeDevice().exportState();
  assert.equal(state.attributes, undefined);
});

// --- importState ---

test("importState restores writable values onto a fresh device", () => {
  const src = makeDevice();
  src.set(PROVCODE, "PROV-RESTORED");
  src.set(SSID, "RestoredNet");
  const snapshot = src.exportState();

  const dst = makeDevice();
  assert.notEqual(dst.getValue(PROVCODE), "PROV-RESTORED");
  dst.importState(snapshot);
  assert.equal(dst.getValue(PROVCODE), "PROV-RESTORED");
  assert.equal(dst.getValue(SSID), "RestoredNet");
});

test("importState restores parameter attributes", () => {
  const state: SavedState = {
    params: {},
    attributes: { [PROVCODE]: { notification: 1, accessList: [] } },
  };
  const d = makeDevice();
  d.importState(state);
  assert.deepEqual(d._parameterAttributes.get(PROVCODE), { notification: 1, accessList: [] });
});

test("importState force-creates an absent leaf with its saved type", () => {
  const d = makeDevice();
  const path = "InternetGatewayDevice.X_Custom.Field";
  d.importState({ params: { [path]: { value: "v", type: "xsd:unsignedInt" } } });
  const node = d.findNode(path) as any;
  assert.equal(node._value, "v");
  assert.equal(node._type, "xsd:unsignedInt");
});

test("importState is a no-op for null/undefined", () => {
  const d = makeDevice();
  assert.doesNotThrow(() => d.importState(null));
  assert.doesNotThrow(() => d.importState(undefined));
});

// --- dirty flag ---

test("a mutation marks the device dirty; saveState clears it", () => {
  const d = makeDevice();
  d._dirty = false; // baseline, as boot would set
  assert.equal(d._dirty, false);

  d.set(PROVCODE, "X");
  assert.equal(d._dirty, true);

  d.saveState();
  assert.equal(d._dirty, false);

  d.set(PROVCODE, "Y");
  assert.equal(d._dirty, true);
});

// --- events ---

test("saveState emits 'save' with the device and its state", () => {
  const d = makeDevice();
  d.set(PROVCODE, "EMIT");
  let received: { dev?: CWMPDevice; state?: SavedState } = {};
  d._events.on("save", (dev: CWMPDevice, state: SavedState) => { received = { dev, state }; });

  const returned = d.saveState();
  assert.equal(received.dev, d);
  assert.equal(received.state?.params[PROVCODE].value, "EMIT");
  assert.deepEqual(received.state, returned);
});

test("importState emits 'load' with the applied state", () => {
  const d = makeDevice();
  const state: SavedState = { params: { [PROVCODE]: { value: "L", type: "xsd:string" } } };
  let loaded: SavedState | null = null;
  d._events.on("load", (_dev: CWMPDevice, s: SavedState) => { loaded = s; });
  d.importState(state);
  assert.deepEqual(loaded, state);
});
