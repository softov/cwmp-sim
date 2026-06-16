<!--
Domain: dashboard
Status: 🟢 Shipped
Priority: Medium
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: fleet/04 (🟢 dynamic control + device:* bus), fleet/01–03 (🟢)
Reference: ./00-dashboard.md
-->

# DASH-01 — Web dashboard + control API

_Status: 🟢 Shipped (Phases 1–3) · Priority: Medium · Created: 2026-06-16_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-dashboard.md, and ../index.md. -->

## Goal

A browser dashboard to **observe and control** a running fleet: a live activity feed of the `device:*`
bus, a fleet tree (groups + devices + their params), and controls to add/remove/restart groups, reboot
devices, trigger informs, and set params — all at runtime. Opt-in via `--dashboard`. **Zero new
dependencies**, **library stays pure** (the dashboard is binary-side and operates on a `CWMPSimulator`
instance; the lib never imports it).

## Reconnaissance

### Files read / searched

- `src/cwmp-sim.ts` — `CWMPSimulator extends EventEmitter`. Control surface (all shipped in fleet/04):
  `addGroup(group) → handle`, `removeGroup(id)`, `restartGroup(id)`, `removeDevice(device)`,
  `rebootDevice(device)`; state in `_devices: CWMPDevice[]` + `_groups: Map<id,{id,devices}>`. Bus:
  `device:add`/`remove`/`boot`/`session`(start,end)/`inform`(code)/`diagnostic`(type,phase)/`save`/`load`.
  No find-by-serial index → dashboard scans `_devices.find(d => d._serialNumber === serial)` (fine for hundreds).
- `src/cwmp-device.ts` — per-device ops the REST layer needs: `getLeaves(path)` (`{name,value,type,writable}[]`),
  `get`/`getValue`/`set(path,value,force?)`, `onConnectionRequest()` (triggers a session/Inform),
  `exportState()`, `_serialNumber`, `_rootName`, `getConnectionHash()`.
- `models.ts` (binary) — `loadModel(path)` for a runtime `addGroup` from a model path in a request body.
- `storage.ts` (binary) — the pattern to mirror: a root binary module doing I/O, lib stays clean.
- `main.ts` — composes options + wires `client.on('device:save', …)`; the place to add `--dashboard` wiring.
- `src/config/fields.ts` — registry for the new `--dashboard` / `--dashboard-port` flags.
- Node built-ins: `http` (server + `upgrade` event), `crypto` (SHA-1 for the WS accept key). **No `ws`.**

### Existing patterns to reuse

- The binary-side root-module pattern (`storage.ts`, `models.ts`) — `dashboard.ts` joins it.
- The `device:*` EventEmitter is the entire data source; control endpoints are 1:1 with fleet/04 methods.
- `config/fields.ts` for the flags; `loadModel` for runtime model loading.

### Gaps

- No HTTP server, REST router, WebSocket server, or UI.
- No find-device-by-serial helper (add a tiny one or scan inline).

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **Binary-side**: root `dashboard.ts` (+ a `ws.ts` for RFC-6455 framing). Takes a `CWMPSimulator`; the library never imports it. | Lib stays pure/IO-free (the session-long boundary). |
| 2 | **Control = REST over `node:http`; live feed = a hand-rolled WebSocket server** (RFC-6455, zero-dep — no `ws`). | User decision (transport). |
| 3 | **Observe + control in v1** — fleet tree + params + live feed AND the control POSTs/DELETEs. | User decision (scope). |
| 4 | **Separate HTTP server** on `--dashboard-port` (default 8080), bound to **127.0.0.1** by default. `--dashboard` enables it. Not bolted onto the CR server (`CWMPConn` stays a pure lib server). | User decision (shape) + it's a control surface → localhost default. |
| 5 | **Single self-contained HTML** served at `/` — inline vanilla JS + CSS, theme `#4ec9b0` on `#020617`, monospace. No framework/build/deps. Browser uses `WebSocket` (client global) + `fetch`. | User decision + earlier UI direction. |
| 6 | **REST maps 1:1 onto fleet/04** — the dashboard adds routing/JSON/WS plumbing, not new device logic. Runtime `addGroup` loads the model **path** via the binary's `loadModel`. | Keeps the lib untouched; consistent IO boundary. |
| 7 | **WS framing as pure functions** (`acceptKey`, `encodeTextFrame`, `decodeFrame`) in `ws.ts`, unit-tested against known vectors — the from-scratch part is verified in isolation. | De-risks the hand-rolled protocol. |

## Proposed architecture

```
main.ts ── if --dashboard ──▶ startDashboard(client, { port, host })
                                   │
dashboard.ts (node:http server, binary)
   GET  /                     → one self-contained HTML page
   GET  /api/fleet            → { groups:[{id,count,devices:[serial,…]}], devices:[{serial,root,groupId}] }
   GET  /api/devices/:serial  → device.getLeaves(root)         (params)
   POST /api/groups           → loadModel(body.model?) → client.addGroup({count,device,model})
   DELETE /api/groups/:id     → client.removeGroup(id)
   POST /api/groups/:id/restart → client.restartGroup(id)
   POST /api/devices/:serial/reboot  → client.rebootDevice(dev)
   DELETE /api/devices/:serial       → client.removeDevice(dev)
   POST /api/devices/:serial/inform  → dev.onConnectionRequest()
   POST /api/devices/:serial/params  → dev.set(path,value,true)
   on 'upgrade' (/api/events) → WS: subscribe client.on('device:*') → broadcast JSON frames

ws.ts (pure, testable): acceptKey(key) · encodeTextFrame(str) · decodeFrame(buf) → {opcode,payload}
```

- **New:** `dashboard.ts` (server + REST + serves HTML + WS broadcast), `ws.ts` (RFC-6455 framing).
- **`main.ts`:** `--dashboard` → `startDashboard(client, {...})`.
- **`src/config/fields.ts`:** `--dashboard` (bool), `--dashboard-port` (default 8080), `--dashboard-host` (default 127.0.0.1) — CLI-only (`CliOptions`), consumed by the binary.
- **Source-of-truth:** control = fleet/04 methods; events = the `device:*` bus.

## Phases

### Phase 1 — REST control API + fleet snapshot — 🟢 SHIPPED

**Objective:** an HTTP server exposing the read + control endpoints over the simulator. **Validation:** endpoints drive the fleet (add/remove/restart/reboot/set/inform) and reflect state. ✅ 10 tests (`test/dashboard.test.ts`, real `http` on port 0 via `fetch`); full suite **183 green**; `tsc` clean.

- [x] **`dashboard.ts`** — `startDashboard(client, opts) → { server, url, close() }`: `node:http` server (host default `127.0.0.1`, port default 8080, 0 = free port); a small `route()` (method + path-segments); `json()`/`readJson()` helpers; `snapshot()` (groups + devices + groupId); `findDevice` by serial; `GET /api/fleet`, `GET /api/devices/:serial`, `POST/DELETE /api/groups[/:id[/restart]]` (`loadModel` for the model path), `POST/DELETE /api/devices/:serial[/reboot|/inform|/params]`; thrown errors → 400; unknown → 404. `GET /` is a placeholder (UI is Phase 3).
- [x] **`tsconfig{,.build}.json`** — `dashboard.ts` added to `include`.
- [x] **Tests:** fleet snapshot shape; device params; add/remove group (+ bad model path → 400); set-param; remove device; reboot/inform call through (stubbed, no network); 404s.

### Phase 2 — WebSocket live feed (hand-rolled RFC-6455) — 🟢 SHIPPED

**Objective:** browsers get a live stream of `device:*` events over a from-scratch WS server. **Validation:** pure frame functions match known vectors; an upgraded socket receives broadcast events. ✅ `test/ws.test.ts` (6) + an E2E test using Node 22's native `WebSocket` **client** against our server; full suite **190 green**; `tsc` clean; still zero deps.

- [x] **`ws.ts`** — `acceptKey(key)` (`base64(sha1(key+GUID))`), `encodeTextFrame(str)` (FIN+text, 7/16/64-bit length, unmasked), `encodeControlFrame(opcode,payload)`, `decodeFrame(buf)` (opcode/fin, unmask client payload, `null` if incomplete), `OPCODES`. Pure + unit-tested.
- [x] **`dashboard.ts`** — `wireFeed` subscribes the 8 `device:*` events → flat JSON `{type,serial,…}`; `handleUpgrade` (path `/api/events`, 101 + accept key, track socket, pong on ping, close on close, drop on close/error); `server.on('upgrade')`; broadcast text frames to all sockets; `close()` destroys sockets then closes the server.
- [x] **Tests:** `test/ws.test.ts` — `acceptKey` vs the RFC vector; `encode`/`decode` round-trip across 7/16/64-bit length boundaries; unmask a masked client frame; `null` on incomplete; control opcodes. `test/dashboard.test.ts` — native `WebSocket` connects and receives a `device:add` broadcast (validates handshake + framing E2E).

**Note:** scope is **unfragmented text + ping/close** (all a feed needs); `decodeFrame` decodes one frame per buffer (control frames are tiny and arrive whole). Documented as the limit.

### Phase 3 — UI + CLI wiring — 🟢 SHIPPED

**Objective:** the single-page UI + `--dashboard` flags. **Validation:** page loads, shows the fleet, streams the feed, and the control buttons hit the REST API. ✅ HTML-serve + flag tests; full suite **192 green**; `tsc` clean; `dist/{dashboard,ws}.js` build; `package.json` dependencies still `{}`.

- [x] **`dashboard.ts`** — `DASHBOARD_HTML`: one self-contained page (inline CSS + vanilla JS, **`createElement`/`textContent` only** — no framework, no inline handlers, XSS-safe). Fleet tree (groups + devices + restart/remove/reboot/inform/remove + set-param inputs), live feed (native `WebSocket` → `/api/events`, reconnecting), add-group form; theme `#4ec9b0`/`#020617` monospace. Served at `GET /`.
- [x] **`src/config/fields.ts` + `config/types.ts`** — `--dashboard` (bool) / `--dashboard-port` (8080) / `--dashboard-host` (127.0.0.1) on `CliOptions`.
- [x] **`main.ts`** — `if (cli.dashboard) startDashboard(client, {port,host})` → prints the URL in the summary.
- [x] **Tests:** `GET /` serves the page (has the app shell + `/api/events` wiring, no external assets); `buildOptions` parses the dashboard flags.
- [x] **`PENDING.md`** — Idea #16 checked.

**Post-ship refinement (codegen, 2026-06-16):** the UI is now **authored in `dashboard.html`** (a real, highlighted, editable file) and **inlined at build time** into `dashboard.generated.ts` by **`gen-html.mjs`** (a ~12-line `node:fs`-only codegen; `export default ` + `JSON.stringify(html)`). `dashboard.ts` imports the generated const. Why codegen and not `?raw`+a custom loader: a runtime loader can't be registered for the published bin (`node dist/main.js`, shebang `node`, no flags; ESM imports resolve before any `register()`), so `?raw` would break `npx`/global installs. Codegen produces a normal string compiled into `dist/` — **no runtime fs, no loader, no `?raw`, no `files` change, still zero deps**. Wiring: `gen:html` npm script + `predev`/`prebuild`/`precheck`/`pretest` hooks; the generated file is git-ignored (always regenerated, never stale). Verified: deleting it then running check/build/test regenerates it; suite **192 green**, deps `{}`.

## Risks & tradeoffs

- **Hand-rolled WS correctness** — masking, multi-byte lengths, fragmentation. Mitigated by pure unit-tested
  `encode/decode` + the standard accept-key vector. Scope to **unfragmented text frames + ping/close** (enough for a feed); document the limit.
- **Security** — this is a control surface (set params, add/remove devices). **Bind 127.0.0.1 by default**; note optional token auth as a follow-up. Don't expose publicly.
- **Event volume** — `device:inform` fires per device per periodic; a large fleet could flood the WS. v1 streams raw; note client-side throttle/batch or a server cap as a follow-up.
- **Device lookup by serial** — O(n) scan (no index). Fine for hundreds; add a `Map` if needed later.
- **Inline HTML size** — one big template string; acceptable (no build), keep it tidy.

## Resume state

- **Done:** **All 3 phases 🟢 shipped.** P1 REST control + fleet snapshot; P2 hand-rolled RFC-6455 WS feed (`ws.ts`); P3 single-page UI + `--dashboard*` flags + `main.ts` wiring. Full suite **192 green**; `tsc` clean; `dist/{dashboard,ws}.js` build; **zero dependencies** (`package.json` unchanged). Run: `cwmp-sim --dashboard` → `http://127.0.0.1:8080/`.
- **Next action:** none. Follow-ups (noted in Risks): optional token auth, `device:inform` throttle/batch for big fleets, richer device panel.
- **Open questions:** None.
- **Open questions:** None.
- **Watch out for:** keep the library import-free of `dashboard.ts`/`ws.ts`; bind localhost by default; `addGroup` from REST must load the model **path** via the binary `loadModel` (lib never reads files).

## Final verification checklist

- [ ] `npm run check` clean; `npm test` green (`dashboard` + `ws` tests).
- [ ] REST: fleet snapshot + add/remove/restart group + reboot/remove/inform/set-param device + 404s.
- [ ] WS: `acceptKey` matches the RFC vector; text-frame encode/decode round-trips (126/127 + masked); ping→pong; live `device:*` broadcast to a connected socket.
- [ ] UI: `/` serves the self-contained page; feed streams; control buttons call REST; theme applied.
- [ ] `--dashboard` / `--dashboard-port` (default 8080) / `--dashboard-host` (default 127.0.0.1); URL printed.
- [ ] Library imports **no** `dashboard.ts`/`ws.ts`/`http`; zero new dependencies (`package.json` unchanged).
- [ ] Status synced: this header, `00-dashboard.md`, `index.md`; PENDING #16 checked.
