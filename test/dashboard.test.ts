import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPSimulator from "../src/cwmp-sim.ts";
import { startDashboard } from "../dashboard.ts";

function makeSim(count = 2) {
  return new CWMPSimulator({
    conn: { port: 0 },
    acs: { url: "http://127.0.0.1:7547/" },
    fleet: { groups: [{ count, device: { rootName: "Device", serialNumber: "SIM-{i}" } }] },
  } as any);
}

const post = (init: any = {}) => ({ method: "POST", headers: { "content-type": "application/json" }, ...init });

test("GET / serves the self-contained dashboard page", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/html/);
    const html = await r.text();
    assert.match(html, /cwmp-sim dashboard/);
    assert.match(html, /id="fleet"/); // the app shell
    assert.match(html, /id="logsearch"/); // log search
    assert.match(html, /id="logclear"/); // log clear
    assert.match(html, /id="evcount"/); // event counter
    assert.match(html, /\/api\/events/); // the WS feed wiring
    assert.doesNotMatch(html, /https?:\/\/cdn|src=/); // no external assets/deps
  } finally {
    await dash.close();
  }
});

test("GET /api/fleet returns groups and devices", async () => {
  const sim = makeSim(2);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/fleet");
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.deepEqual(body.devices.map((d: any) => d.serial), ["SIM-0", "SIM-1"]);
    assert.equal(body.groups.length, 1);
    assert.equal(body.groups[0].count, 2);
    assert.equal(body.devices[0].groupId, body.groups[0].id);
  } finally {
    await dash.close();
  }
});

test("GET /api/devices/:serial includes stats", async () => {
  const sim = makeSim(1);
  sim._devices[0]._recordRpc("GetParameterValues", "recv");
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const body: any = await (await fetch(dash.url + "api/devices/SIM-0")).json();
    assert.ok(body.stats);
    assert.equal(body.stats.rpc.GetParameterValues, 1);
    assert.equal(body.stats.pending, 0);
  } finally {
    await dash.close();
  }
});

test("GET /api/fleet includes the global stats + per-device summary", async () => {
  const sim = makeSim(2);
  sim._devices[0]._recordRpc("SetParameterValues", "recv");
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const body: any = await (await fetch(dash.url + "api/fleet")).json();
    assert.ok(body.global);
    assert.equal(body.global.rpc.SetParameterValues, 1);
    assert.equal(typeof body.devices[0].informs, "number");
    assert.equal(typeof body.devices[0].recv, "number");
  } finally {
    await dash.close();
  }
});

test("GET /api/devices/:serial returns its params", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/devices/SIM-0");
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.equal(body.serial, "SIM-0");
    const leaf = body.params.find((p: any) => p.name === "Device.DeviceInfo.SerialNumber");
    assert.equal(leaf.value, "SIM-0");
  } finally {
    await dash.close();
  }
});

test("POST /api/groups adds a group of devices", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/groups", post({ body: JSON.stringify({ count: 2, device: { rootName: "Device", serialNumber: "NEW-{i}" } }) }));
    assert.equal(r.status, 201);
    const body: any = await r.json();
    assert.equal(body.devices.length, 2);
    assert.equal(sim._devices.length, 3);
  } finally {
    await dash.close();
  }
});

test("POST /api/groups with a missing model path returns 400", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/groups", post({ body: JSON.stringify({ model: "./does-not-exist.csv", count: 1 }) }));
    assert.equal(r.status, 400);
    assert.equal(sim._devices.length, 1); // unchanged
  } finally {
    await dash.close();
  }
});

test("DELETE /api/groups/:id removes the group", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const h = sim.addGroup({ count: 2, device: { rootName: "Device", serialNumber: "G-{i}" } });
    assert.equal(sim._devices.length, 3);
    const r = await fetch(dash.url + "api/groups/" + h.id, { method: "DELETE" });
    assert.equal(r.status, 200);
    assert.equal(sim._devices.length, 1);
  } finally {
    await dash.close();
  }
});

test("POST /api/devices/:serial/params sets a writable param", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const path = "Device.ManagementServer.PeriodicInformInterval";
    const r = await fetch(dash.url + "api/devices/SIM-0/params", post({ body: JSON.stringify({ path, value: "300" }) }));
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as any).ok, true);
    assert.equal(sim._devices[0].getValue(path), "300");
  } finally {
    await dash.close();
  }
});

test("DELETE /api/devices/:serial removes the device", async () => {
  const sim = makeSim(2);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/devices/SIM-0", { method: "DELETE" });
    assert.equal(r.status, 200);
    assert.equal(sim._devices.length, 1);
    assert.equal(sim._devices[0]._serialNumber, "SIM-1");
  } finally {
    await dash.close();
  }
});

test("POST /api/devices/:serial/reboot calls rebootDevice", async () => {
  const sim = makeSim(1);
  let rebooted: unknown = null;
  (sim as any).rebootDevice = (d: unknown) => { rebooted = d; };
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/devices/SIM-0/reboot", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(rebooted, sim._devices[0]);
  } finally {
    await dash.close();
  }
});

test("POST /api/devices/:serial/inform triggers a connection request", async () => {
  const sim = makeSim(1);
  let informed = false;
  (sim._devices[0] as any).onConnectionRequest = () => { informed = true; };
  const dash = await startDashboard(sim, { port: 0 });
  try {
    const r = await fetch(dash.url + "api/devices/SIM-0/inform", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(informed, true);
  } finally {
    await dash.close();
  }
});

test("unknown route and unknown device return 404", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  try {
    assert.equal((await fetch(dash.url + "api/nope")).status, 404);
    assert.equal((await fetch(dash.url + "api/devices/GHOST")).status, 404);
  } finally {
    await dash.close();
  }
});

// End-to-end through the hand-rolled WS server, using Node's native WebSocket
// client (validates the handshake/accept-key + text framing for real).
test("WS /api/events streams device:* events to a connected client", async () => {
  const sim = makeSim(1);
  const dash = await startDashboard(sim, { port: 0 });
  const ws = new WebSocket(dash.url.replace("http://", "ws://") + "api/events");
  try {
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (e) => reject(e), { once: true });
    });
    const message = new Promise<any>((resolve) => {
      ws.addEventListener("message", (e: any) => resolve(JSON.parse(e.data)), { once: true });
    });

    sim.addGroup({ count: 1, device: { rootName: "Device", serialNumber: "WS-{i}" } }); // emits device:add

    const msg = await message;
    assert.equal(msg.type, "device:add");
    assert.equal(msg.serial, "WS-1");
  } finally {
    ws.close();
    await dash.close();
  }
});
