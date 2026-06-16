import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPSimulator from "../src/cwmp-sim.ts";
import type CWMPDevice from "../src/cwmp-device.ts";

function makeSim(count = 2) {
  return new CWMPSimulator({
    conn: { port: 0 },
    acs: { url: "http://127.0.0.1:7547/" },
    fleet: { groups: [{ count, device: { rootName: "Device", serialNumber: "SIM-{i}" } }] },
  } as any);
}

const SERIAL = "Device.DeviceInfo.SerialNumber";
const INTERVAL = "Device.ManagementServer.PeriodicInformInterval"; // writable

// Avoid real network: stub a device's stop/start to record calls.
function spyLifecycle(device: CWMPDevice, calls: string[]) {
  device.stop = () => { calls.push("stop"); };
  device.start = ((e?: string) => { calls.push("start:" + e); }) as CWMPDevice["start"];
}

// --- handles + add ---

test("addGroup returns a handle with id, devices, remove(), restart()", () => {
  const sim = makeSim(1);
  const h = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "X-{i}" } });
  assert.equal(typeof h.id, "string");
  assert.equal(h.devices.length, 2);
  assert.equal(typeof h.remove, "function");
  assert.equal(typeof h.restart, "function");
  assert.equal(sim._devices.length, 3); // 1 initial + 2 added
});

test("runtime addGroup emits device:add per new device", () => {
  const sim = makeSim(1);
  const added: CWMPDevice[] = [];
  sim.on("device:add", (d: CWMPDevice) => added.push(d));
  const h = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "X-{i}" } });
  assert.deepEqual(added, h.devices);
});

// --- remove ---

test("handle.remove() drops the group's devices and emits device:remove", () => {
  const sim = makeSim(1);
  const removed: CWMPDevice[] = [];
  sim.on("device:remove", (d: CWMPDevice) => removed.push(d));
  const h = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "X-{i}" } });
  const groupDevices = [...h.devices];
  h.remove();
  assert.equal(sim._devices.length, 1); // back to the initial device
  assert.deepEqual(removed, groupDevices);
  assert.equal(sim._groups.has(h.id), false);
});

test("removeDevice saves a dirty device before dropping it", () => {
  const sim = makeSim(1);
  const d = sim._devices[0];
  d._dirty = false;
  d.set(INTERVAL, "300"); // make it dirty
  let saved: { dev?: CWMPDevice } = {};
  sim.on("device:save", (dev: CWMPDevice) => { saved = { dev }; });
  sim.removeDevice(d);
  assert.equal(saved.dev, d);
  assert.equal(sim._devices.length, 0);
});

test("removeDevice does not throw when the CR server isn't listening", () => {
  const sim = makeSim(2);
  assert.doesNotThrow(() => sim.removeDevice(sim._devices[0]));
  assert.equal(sim._devices.length, 1);
});

test("removeGroup on an unknown id is a no-op", () => {
  const sim = makeSim(1);
  assert.doesNotThrow(() => sim.removeGroup("nope"));
  assert.equal(sim._devices.length, 1);
});

// --- restart / reboot ---

test("rebootDevice stops then starts the device with 1 BOOT", () => {
  const sim = makeSim(1);
  const calls: string[] = [];
  spyLifecycle(sim._devices[0], calls);
  sim.rebootDevice(sim._devices[0]);
  assert.deepEqual(calls, ["stop", "start:1 BOOT"]);
});

test("restartGroup reboots every device in the group", () => {
  const sim = makeSim(1);
  const h = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "X-{i}" } });
  const calls: string[] = [];
  for (const d of h.devices) spyLifecycle(d, calls);
  sim.restartGroup(h.id);
  assert.deepEqual(calls, ["stop", "start:1 BOOT", "stop", "start:1 BOOT"]);
});

// --- index ---

test("the fleet index is monotonic across remove + add (no reuse)", () => {
  const sim = makeSim(2); // SIM-0, SIM-1
  sim.removeDevice(sim._devices[0]); // remove SIM-0
  const h = sim.addGroup({ count: 1, device: { rootName: "Device", serialNumber: "SIM-{i}" } });
  assert.equal(h.devices[0].getValue(SERIAL), "SIM-2"); // index 2, not the freed 0
});

// --- lifecycle event bus (Phase 2) ---

test("simulator forwards device lifecycle events as device:*", () => {
  const sim = makeSim(1);
  const d = sim._devices[0];
  const events: unknown[] = [];
  sim.on("device:boot", (_d: CWMPDevice, e: string) => events.push(["boot", e]));
  sim.on("device:inform", (_d: CWMPDevice, e: string) => events.push(["inform", e]));
  sim.on("device:session", (_d: CWMPDevice, phase: string, e?: string) => events.push(["session", phase, e]));
  sim.on("device:diagnostic", (_d: CWMPDevice, type: string, phase: string) => events.push(["diagnostic", type, phase]));

  d._events.emit("boot", d, "1 BOOT");
  d._events.emit("session-start", d, "1 BOOT");
  d._events.emit("inform", d, "1 BOOT");
  d._events.emit("diagnostic", d, "ping", "start");
  d._events.emit("session-end", d);

  assert.deepEqual(events, [
    ["boot", "1 BOOT"],
    ["session", "start", "1 BOOT"],
    ["inform", "1 BOOT"],
    ["diagnostic", "ping", "start"],
    ["session", "end", undefined],
  ]);
});

test("device.start() emits boot", () => {
  const d = makeSim(1)._devices[0];
  d.startSession = (async () => {}) as CWMPDevice["startSession"]; // avoid network
  let booted: string | null = null;
  d._events.on("boot", (_d: CWMPDevice, e: string) => { booted = e; });
  d.start("1 BOOT");
  assert.equal(booted, "1 BOOT");
});

test("device.startSession() emits session-start and inform with the event code", async () => {
  const d = makeSim(1)._devices[0];
  d.sendRequest = (async () => null) as CWMPDevice["sendRequest"];
  d.handleMethod = (async () => null) as CWMPDevice["handleMethod"]; // avoid session-end / periodic timer
  const seen: unknown[] = [];
  d._events.on("session-start", (_d: CWMPDevice, e: string) => seen.push(["session-start", e]));
  d._events.on("inform", (_d: CWMPDevice, e: string) => seen.push(["inform", e]));
  await d.startSession("2 PERIODIC");
  assert.deepEqual(seen, [["session-start", "2 PERIODIC"], ["inform", "2 PERIODIC"]]);
});

test("addTask/finishTask emit diagnostic start/end with the raw task type", () => {
  const d = makeSim(1)._devices[0];
  const seen: unknown[] = [];
  d._events.on("diagnostic", (_d: CWMPDevice, type: string, phase: string) => seen.push([type, phase]));
  const task = { _type: "diag-ping" } as any;
  d.addTask(task);
  d.finishTask(task);
  // Drop the timers addTask/finishTask scheduled (runTask + the follow-up inform).
  if (d._pendingTimeout) clearTimeout(d._pendingTimeout);
  if (d._periodicInformTimeout) clearTimeout(d._periodicInformTimeout);
  assert.deepEqual(seen, [["diag-ping", "start"], ["diag-ping", "end"]]);
});

test("session-end still triggers the dirty-gated auto-save", () => {
  const sim = makeSim(1);
  const d = sim._devices[0];
  d._dirty = false;
  d.set(INTERVAL, "120"); // dirty
  let saved = false;
  sim.on("device:save", () => { saved = true; });
  d._events.emit("session-end", d);
  assert.equal(saved, true);
});
