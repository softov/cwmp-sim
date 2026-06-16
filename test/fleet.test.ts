import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPSimulator from "../src/cwmp-sim.ts";

function makeOptions(over: Record<string, unknown> = {}) {
  return {
    device: { rootName: "Device", serialNumber: "SIM-{i}" },
    conn: { port: 0 },
    acs: { url: "http://127.0.0.1:7547/" },
    ...over,
  } as any;
}

const SERIAL = "Device.DeviceInfo.SerialNumber";

test("fleet builds N devices with distinct templated identities", () => {
  const sim = new CWMPSimulator(makeOptions({ fleet: { count: 3 } }));
  assert.equal(sim._devices.length, 3);
  assert.equal(sim._devices[0].getValue(SERIAL), "SIM-0");
  assert.equal(sim._devices[1].getValue(SERIAL), "SIM-1");
  assert.equal(sim._devices[2].getValue(SERIAL), "SIM-2");
});

test("single device is a fleet of one; _device is the first", () => {
  const sim = new CWMPSimulator(makeOptions());
  assert.equal(sim._devices.length, 1);
  assert.equal(sim._device, sim._devices[0]);
  assert.equal(sim._device.getValue(SERIAL), "SIM-0");
});

test("base device.index offsets the whole fleet", () => {
  const sim = new CWMPSimulator(
    makeOptions({ device: { rootName: "Device", serialNumber: "SIM-{i}", index: 10 }, fleet: { count: 2 } }),
  );
  assert.equal(sim._devices[0].getValue(SERIAL), "SIM-10");
  assert.equal(sim._devices[1].getValue(SERIAL), "SIM-11");
});

test("each device gets the ACS config in its ManagementServer", () => {
  const sim = new CWMPSimulator(makeOptions({ acs: { url: "http://acs/x", user: "u", pass: "p" }, fleet: { count: 2 } }));
  for (const d of sim._devices) {
    assert.equal(d.getValue("Device.ManagementServer.URL"), "http://acs/x");
  }
});
