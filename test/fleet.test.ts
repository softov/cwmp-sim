import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPSimulator from "../src/cwmp-sim.ts";
import CWMPDevice from "../src/cwmp-device.ts";
import { buildOptions } from "../src/config/index.ts";
import { resolveFleet } from "../models.ts";

// A single default group of `count` devices (TR-181), with optional overrides.
function makeOptions(over: Record<string, any> = {}) {
  const { count = 1, index, device = {}, ...rest } = over;
  return {
    conn: { port: 0 },
    acs: { url: "http://127.0.0.1:7547/" },
    fleet: {
      ...(index !== undefined ? { index } : {}),
      groups: [{ count, device: { rootName: "Device", serialNumber: "SIM-{i}", ...device } }],
    },
    ...rest,
  } as any;
}

// Compose library options the way main.ts does: cli parts + resolved fleet.
function simOptions(cli: ReturnType<typeof buildOptions>) {
  return { conn: cli.conn, acs: cli.acs, log: cli.log, fleet: resolveFleet(cli.fleet) };
}

const SERIAL = "Device.DeviceInfo.SerialNumber";

test("fleet builds N devices with distinct templated identities", () => {
  const sim = new CWMPSimulator(makeOptions({ count: 3 }));
  assert.equal(sim._devices.length, 3);
  assert.equal(sim._devices[0].getValue(SERIAL), "SIM-0");
  assert.equal(sim._devices[1].getValue(SERIAL), "SIM-1");
  assert.equal(sim._devices[2].getValue(SERIAL), "SIM-2");
});

test("single device is a fleet of one", () => {
  const sim = new CWMPSimulator(makeOptions());
  assert.equal(sim._devices.length, 1);
  assert.equal(sim._devices[0].getValue(SERIAL), "SIM-0");
});

test("the fleet base index offsets the whole fleet", () => {
  const sim = new CWMPSimulator(makeOptions({ count: 2, index: 10 }));
  assert.equal(sim._devices[0].getValue(SERIAL), "SIM-10");
  assert.equal(sim._devices[1].getValue(SERIAL), "SIM-11");
});

test("each device gets the ACS config in its ManagementServer", () => {
  const sim = new CWMPSimulator(makeOptions({ count: 2, acs: { url: "http://acs/x", user: "u", pass: "p" } }));
  for (const d of sim._devices) {
    assert.equal(d.getValue("Device.ManagementServer.URL"), "http://acs/x");
  }
});

// --- Grouped-flag fleet composition (fleet/02 Phase 3) ---

// These exercise the full CLI→library pipeline: buildOptions (config, model paths)
// → resolveFleet (binary, loads model files) → CWMPSimulator (objects).

test("grouped flags split counts with a global index across groups", () => {
  const cli = buildOptions({}, [
    "--acs", "http://acs/",
    "--model", "default", "--serial", "A-{i}", "--count", "2",
    "--model", "default", "--serial", "B-{i}", "--count", "3",
  ]);
  assert.equal(cli.fleet?.groups?.length, 2);
  const sim = new CWMPSimulator(simOptions(cli));
  assert.equal(sim._devices.length, 5);
  // group-scoped serial differs per group; index runs continuously across groups
  assert.deepEqual(sim._devices.map((d) => d.getValue(SERIAL)), ["A-0", "A-1", "B-2", "B-3", "B-4"]);
});

test("a global flag applies to every group", () => {
  const cli = buildOptions({}, [
    "--acs", "http://acs/all",
    "--model", "default", "--count", "1",
    "--model", "default", "--count", "1",
  ]);
  const sim = new CWMPSimulator(simOptions(cli));
  for (const d of sim._devices) assert.equal(d.getValue("Device.ManagementServer.URL"), "http://acs/all");
});

test("group flags before the first --model seed the base inherited by all groups", () => {
  const cli = buildOptions({}, [
    "--serial", "S-{i}",
    "--model", "default", "--count", "1",
    "--model", "default", "--oui", "00E0{i:02x}", "--count", "1",
  ]);
  const sim = new CWMPSimulator(simOptions(cli));
  // both inherit the base serial pattern; the 2nd group additionally overrides OUI
  assert.equal(sim._devices[0].getValue(SERIAL), "S-0");
  assert.equal(sim._devices[1].getValue(SERIAL), "S-1");
  assert.equal(sim._devices[1].getValue("Device.DeviceInfo.ManufacturerOUI"), "00E001");
});

test("no --model falls back to a single group from --count", () => {
  const cli = buildOptions({}, ["--serial", "SIM-{i}", "--count", "3"]);
  assert.equal(cli.fleet?.groups?.length, 1);
  assert.equal(cli.fleet?.groups?.[0].count, 3);
  const sim = new CWMPSimulator(simOptions(cli));
  assert.deepEqual(sim._devices.map((d) => d.getValue(SERIAL)), ["SIM-0", "SIM-1", "SIM-2"]);
});

test("addGroup is reusable and keeps the fleet index running", () => {
  const sim = new CWMPSimulator(makeOptions({ count: 2 }));
  assert.equal(sim._devices.length, 2);
  const handle = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "SIM-{i}" } });
  assert.equal(handle.devices.length, 2);
  assert.equal(sim._devices.length, 4);
  // indices continue past the initial group (0,1 → 2,3)
  assert.deepEqual(sim._devices.map((d) => d.getValue(SERIAL)), ["SIM-0", "SIM-1", "SIM-2", "SIM-3"]);
});

test("--off cr: a noCr device is not CR-registered and gets no ConnectionRequestURL", () => {
  const sim = new CWMPSimulator(makeOptions());
  const registered: string[] = [];
  // Stub the CR server + connection so _registerAndBoot runs without listening.
  (sim as any)._connectRequestServer = { register: (h: string) => registered.push(h), unregister() {} };
  (sim as any)._connection = { url: "http://cr.local/" };

  const normal = sim._devices[0];
  (normal as any).start = () => {};
  sim._registerAndBoot(normal, 0);
  assert.equal(registered.length, 1); // normal device registers
  assert.match(normal.getValue("Device.ManagementServer.ConnectionRequestURL"), /^http:\/\/cr\.local\//);

  const off = new CWMPDevice({ rootName: "Device", serialNumber: "OFF-CR", noCr: true });
  (off as any).start = () => {};
  sim._registerAndBoot(off, 0);
  assert.equal(registered.length, 1); // unchanged — noCr skipped registration
  assert.equal(off.getValue("Device.ManagementServer.ConnectionRequestURL"), "");
});
