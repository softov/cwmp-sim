// Binary-side dashboard server. Like storage.ts/models.ts it lives OUTSIDE src/:
// the library stays pure and never imports this. A thin REST layer over the
// fleet/04 control API + (Phase 2) a hand-rolled WebSocket live feed + (Phase 3)
// a single self-contained HTML page. Zero dependencies — node:http only.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type CWMPSimulator from "./src/cwmp-sim.ts";
import type CWMPDevice from "./src/cwmp-device.ts";
import { loadModel } from "./models.ts";
import { acceptKey, encodeTextFrame, encodeControlFrame, decodeFrame, OPCODES } from "./ws.ts";
// The UI is authored in dashboard.html and inlined here at build time by
// gen-html.mjs (codegen) — ships compiled in dist/, no runtime fs, no loader.
import DASHBOARD_HTML from "./dashboard.generated.ts";

export type DashboardOptions = { port?: number; host?: string };
export type Dashboard = { server: Server; url: string; close(): Promise<void> };

// --- helpers ---

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function findDevice(client: CWMPSimulator, serial: string): CWMPDevice | null {
  return client._devices.find((d) => d._serialNumber === serial) ?? null;
}

function groupIdOf(client: CWMPSimulator, device: CWMPDevice): string | null {
  for (const g of client._groups.values()) if (g.devices.includes(device)) return g.id;
  return null;
}

/** A JSON snapshot of the fleet for the dashboard's initial render. */
function snapshot(client: CWMPSimulator) {
  return {
    groups: [...client._groups.values()].map((g) => ({
      id: g.id,
      count: g.devices.length,
      devices: g.devices.map((d) => d._serialNumber),
    })),
    devices: client._devices.map((d) => ({
      serial: d._serialNumber,
      root: d._rootName,
      groupId: groupIdOf(client, d),
    })),
  };
}

// --- routing ---

/**
 * Routes one request against the simulator. Control endpoints map 1:1 onto the
 * fleet/04 API; the library does the work, this is just HTTP plumbing.
 */
async function route(client: CWMPSimulator, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (method === "GET" && parts.length === 0) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (parts[0] !== "api") return json(res, 404, { error: "not found" });

  // GET /api/fleet
  if (method === "GET" && parts[1] === "fleet" && parts.length === 2) {
    return json(res, 200, snapshot(client));
  }

  // /api/groups …
  if (parts[1] === "groups") {
    if (method === "POST" && parts.length === 2) {
      const body = await readJson(req);
      const model = body.model ? loadModel(body.model) : undefined;
      const h = client.addGroup({ count: body.count ?? 1, device: body.device ?? {}, model });
      return json(res, 201, { id: h.id, devices: h.devices.map((d) => d._serialNumber) });
    }
    const id = parts[2];
    if (method === "DELETE" && parts.length === 3) {
      client.removeGroup(id);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && parts.length === 4 && parts[3] === "restart") {
      client.restartGroup(id);
      return json(res, 200, { ok: true });
    }
  }

  // /api/devices …
  if (parts[1] === "devices") {
    const serial = parts[2] ? decodeURIComponent(parts[2]) : "";
    const device = serial ? findDevice(client, serial) : null;
    if (parts.length >= 3 && !device) return json(res, 404, { error: `no device '${serial}'` });

    if (method === "GET" && parts.length === 3 && device) {
      return json(res, 200, { serial, root: device._rootName, params: device.getLeaves(device._rootName) });
    }
    if (method === "DELETE" && parts.length === 3 && device) {
      client.removeDevice(device);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && parts.length === 4 && device) {
      if (parts[3] === "reboot") {
        client.rebootDevice(device);
        return json(res, 200, { ok: true });
      }
      if (parts[3] === "inform") {
        device.onConnectionRequest();
        return json(res, 200, { ok: true });
      }
      if (parts[3] === "params") {
        const body = await readJson(req);
        const ok = device.set(body.path, String(body.value), true);
        return json(res, 200, { ok });
      }
    }
  }

  return json(res, 404, { error: "not found" });
}

// --- live feed (WebSocket) ---

type Broadcast = (event: Record<string, unknown>) => void;

/** Subscribes the `device:*` bus to a broadcast sink, normalized to flat JSON. */
function wireFeed(client: CWMPSimulator, send: Broadcast): void {
  const s = (d: CWMPDevice) => d._serialNumber;
  client.on("device:add", (d: CWMPDevice) => send({ type: "device:add", serial: s(d), root: d._rootName }));
  client.on("device:remove", (d: CWMPDevice) => send({ type: "device:remove", serial: s(d) }));
  client.on("device:boot", (d: CWMPDevice, event: string) => send({ type: "device:boot", serial: s(d), event }));
  client.on("device:session", (d: CWMPDevice, phase: string, event?: string) => send({ type: "device:session", serial: s(d), phase, event }));
  client.on("device:inform", (d: CWMPDevice, event: string) => send({ type: "device:inform", serial: s(d), event }));
  client.on("device:diagnostic", (d: CWMPDevice, diag: string, phase: string) => send({ type: "device:diagnostic", serial: s(d), diagnostic: diag, phase }));
  client.on("device:save", (d: CWMPDevice) => send({ type: "device:save", serial: s(d) }));
  client.on("device:load", (d: CWMPDevice) => send({ type: "device:load", serial: s(d) }));
}

/** Completes the WebSocket handshake for `/api/events` and tracks the socket. */
function handleUpgrade(req: IncomingMessage, socket: Socket, sockets: Set<Socket>): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const key = req.headers["sec-websocket-key"];
  if (url.pathname !== "/api/events" || typeof key !== "string") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  sockets.add(socket);

  socket.on("data", (chunk: Buffer) => {
    const frame = decodeFrame(chunk);
    if (!frame) return;
    if (frame.opcode === OPCODES.PING) socket.write(encodeControlFrame(OPCODES.PONG, frame.payload));
    else if (frame.opcode === OPCODES.CLOSE) {
      socket.write(encodeControlFrame(OPCODES.CLOSE));
      socket.end();
    }
  });

  const drop = () => sockets.delete(socket);
  socket.on("close", drop);
  socket.on("error", drop);
}

/**
 * Starts the dashboard HTTP server bound to `host` (default 127.0.0.1 — it's a
 * control surface) on `port` (default 8080; 0 picks a free port). REST for
 * control, a WebSocket at `/api/events` streaming the `device:*` bus. Resolves
 * with the server, its URL, and a `close()`.
 */
export function startDashboard(client: CWMPSimulator, opts: DashboardOptions = {}): Promise<Dashboard> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8080;

  const sockets = new Set<Socket>();
  wireFeed(client, (event) => {
    if (sockets.size === 0) return;
    const frame = encodeTextFrame(JSON.stringify(event));
    for (const s of sockets) s.write(frame);
  });

  const server = createServer((req, res) => {
    route(client, req, res).catch((err) => {
      json(res, 400, { error: String(err?.message ?? err) });
    });
  });
  server.on("upgrade", (req, socket) => handleUpgrade(req, socket as Socket, sockets));

  return new Promise<Dashboard>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        url: `http://${host}:${actualPort}/`,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}
