import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPSimulator from "../src/cwmp-sim.ts";
import { buildOptions } from "../src/config/index.ts";

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

// --- Grouped-flag fleet composition (fleet/02 Phase 3) ---

test("grouped flags split counts with a global index across groups", () => {
  const opts = buildOptions({}, [
    "--acs", "http://acs/",
    "--model", "default", "--serial", "A-{i}", "--count", "2",
    "--model", "default", "--serial", "B-{i}", "--count", "3",
  ]);
  assert.equal(opts.fleet?.groups?.length, 2);
  const sim = new CWMPSimulator(opts);
  assert.equal(sim._devices.length, 5);
  // group-scoped serial differs per group; index runs continuously across groups
  assert.deepEqual(sim._devices.map((d) => d.getValue(SERIAL)), ["A-0", "A-1", "B-2", "B-3", "B-4"]);
});

test("a global flag applies to every group", () => {
  const opts = buildOptions({}, [
    "--acs", "http://acs/all",
    "--model", "default", "--count", "1",
    "--model", "default", "--count", "1",
  ]);
  const sim = new CWMPSimulator(opts);
  for (const d of sim._devices) assert.equal(d.getValue("Device.ManagementServer.URL"), "http://acs/all");
});

test("group flags before the first --model seed the base inherited by all groups", () => {
  const opts = buildOptions({}, [
    "--serial", "S-{i}",
    "--model", "default", "--count", "1",
    "--model", "default", "--oui", "00E0{i:02x}", "--count", "1",
  ]);
  const sim = new CWMPSimulator(opts);
  // both inherit the base serial pattern; the 2nd group additionally overrides OUI
  assert.equal(sim._devices[0].getValue(SERIAL), "S-0");
  assert.equal(sim._devices[1].getValue(SERIAL), "S-1");
  assert.equal(sim._devices[1].getValue("Device.DeviceInfo.ManufacturerOUI"), "00E001");
});

test("no --model falls back to a single group from --count", () => {
  const opts = buildOptions({}, ["--serial", "SIM-{i}", "--count", "3"]);
  assert.equal(opts.fleet?.groups?.length, 1);
  assert.equal(opts.fleet?.groups?.[0].count, 3);
  const sim = new CWMPSimulator(opts);
  assert.deepEqual(sim._devices.map((d) => d.getValue(SERIAL)), ["SIM-0", "SIM-1", "SIM-2"]);
});

test("addGroup is reusable and keeps the fleet index running", () => {
  const sim = new CWMPSimulator(makeOptions({ fleet: { count: 2 } }));
  assert.equal(sim._devices.length, 2);
  const added = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "SIM-{i}" } });
  assert.equal(added.length, 2);
  assert.equal(sim._devices.length, 4);
  // indices continue past the initial group (0,1 → 2,3)
  assert.deepEqual(sim._devices.map((d) => d.getValue(SERIAL)), ["SIM-0", "SIM-1", "SIM-2", "SIM-3"]);
});
