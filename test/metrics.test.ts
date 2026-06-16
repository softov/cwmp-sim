import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPDevice from "../src/cwmp-device.ts";
import CWMPSimulator from "../src/cwmp-sim.ts";
import type { RpcEvent } from "../src/types.ts";

function makeDevice() {
  return new CWMPDevice({ rootName: "Device", serialNumber: "S" });
}
function makeSim(count = 1) {
  return new CWMPSimulator({
    conn: { port: 0 },
    acs: { url: "http://127.0.0.1:7547/" },
    fleet: { groups: [{ count, device: { rootName: "Device", serialNumber: "SIM-{i}" } }] },
  } as any);
}

// --- device stats ---

test("device counts received RPCs and tracks last-received", () => {
  const d = makeDevice();
  d._recordRpc("GetParameterValues", "recv");
  d._recordRpc("GetParameterValues", "recv");
  d._recordRpc("SetParameterValues", "recv");
  const s = d.getStats();
  assert.equal(s.rpc.GetParameterValues, 2);
  assert.equal(s.rpc.SetParameterValues, 1);
  assert.equal(s.lastRecv?.method, "SetParameterValues");
});

test("device counts sent RPCs separately and tracks last-sent", () => {
  const d = makeDevice();
  d._recordRpc("Inform", "sent");
  d._recordRpc("GetParameterValuesResponse", "sent");
  const s = d.getStats();
  assert.equal(s.sent.Inform, 1);
  assert.equal(s.sent.GetParameterValuesResponse, 1);
  assert.equal(s.lastSent?.method, "GetParameterValuesResponse");
  assert.equal(s.rpc.Inform, undefined); // sent ≠ recv
});

test("recordFault increments failures and emits a fail rpc with the path", () => {
  const d = makeDevice();
  let info: RpcEvent | null = null;
  d._events.on("rpc", (_dev: CWMPDevice, i: RpcEvent) => { info = i; });
  d.recordFault("Device.ManagementServer.PeriodicInformInterval");
  assert.equal(d.getStats().failures, 1);
  assert.equal(info!.ok, false);
  assert.equal(info!.dir, "fail");
  assert.equal(info!.detail, "Device.ManagementServer.PeriodicInformInterval");
});

test("finishTask appends to the task history, capped at 20 (newest last)", () => {
  const d = makeDevice();
  for (let i = 0; i < 25; i++) {
    d.finishTask({ _type: `t${i}` } as any);
    if (d._pendingTimeout) clearTimeout(d._pendingTimeout);
    if (d._periodicInformTimeout) clearTimeout(d._periodicInformTimeout);
  }
  const s = d.getStats();
  assert.equal(s.tasks.length, 20);
  assert.equal(s.tasks[0].type, "t5"); // oldest five dropped
  assert.equal(s.tasks[19].type, "t24");
});

test("getStats reports live pending-task count", () => {
  const d = makeDevice();
  assert.equal(d.getStats().pending, 0);
  d._pendingTask.push({} as any, {} as any);
  assert.equal(d.getStats().pending, 2);
});

// --- simulator global (lifetime) ---

test("simulator accumulates global stats and forwards device:rpc", () => {
  const sim = makeSim(1);
  const d = sim._devices[0];
  const seen: RpcEvent[] = [];
  sim.on("device:rpc", (_dev: CWMPDevice, info: RpcEvent) => seen.push(info));

  d._recordRpc("SetParameterValues", "recv");
  d._recordRpc("SetParameterValues", "recv");
  assert.equal(sim.globalStats().rpc.SetParameterValues, 2);
  assert.deepEqual(seen.map((i) => i.method), ["SetParameterValues", "SetParameterValues"]);
});

test("global counters are lifetime — a removed device's counts persist", () => {
  const sim = makeSim(2);
  sim._devices[0]._recordRpc("GetParameterValues", "recv");
  sim._devices[1]._recordRpc("GetParameterValues", "recv");
  assert.equal(sim.globalStats().rpc.GetParameterValues, 2);

  sim.removeDevice(sim._devices[0]); // remove one
  assert.equal(sim._devices.length, 1);
  assert.equal(sim.globalStats().rpc.GetParameterValues, 2); // still 2 (cumulative)
});

test("simulator counts informs globally + last-inform", () => {
  const sim = makeSim(1);
  sim._devices[0]._events.emit("inform", sim._devices[0], "2 PERIODIC");
  const g = sim.globalStats();
  assert.equal(g.informs, 1);
  assert.equal(typeof g.lastInform, "number");
});

test("a fault rpc bumps global failures", () => {
  const sim = makeSim(1);
  sim._devices[0].recordFault("Device.X");
  assert.equal(sim.globalStats().failures, 1);
});
