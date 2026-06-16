<!--
Domain: fleet
Status: 🟢 Shipped
Priority: High
Created: 2026-06-15
Revalidated: 2026-06-15
Dependencies: architecture/01 (🟢), enhancements/01·P3 (🟢, {i} templating), enhancements/02 (🟢, logger); session-into-device refactor (done)
Reference: ./00-fleet.md
-->

# FLEET-01 — Multi-device runtime

_Status: 🟢 Shipped · Priority: High · Created: 2026-06-15_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-fleet.md, and ../index.md. -->

## Goal

Run **N self-running CPEs in one process**, behind a **single shared Connection Request server** that
routes incoming requests to the right device by URL path (`http://addr:port/{hash}`). Driven by
`--count N`: each device is a clone of the same model with an index-derived identity (`{i}` serial/MAC),
booted with a small stagger so they don't stampede the ACS. In-process (not fork-per-device) so a future
dashboard can start/stop/inspect devices directly. This is the runtime spine; device **templates**
(multiple types) and per-device **state** persistence are later fleet plans.

## Reconnaissance

### Files read

- `src/cwmp-conn.ts` — `listenHTTP(callback)` does a one-time egress-socket IP probe (connect to the ACS to learn the local addr), binds **one** `http.Server`, and the handler **hard-rejects any path but `/`** (`if (req.url !== '/') 404`). `handleRequest` authenticates against a **single** `this._options.user/pass` (+ `authMode`) and fires a **single** `this._onRequest("6 CONNECTION REQUEST")`. `md5()` helper already present. → must become path-routed + per-device.
- `src/cwmp-sim.ts` — post-refactor orchestrator: owns **1** device + **1** `CWMPConn` (1:1). `start()` = `listenHTTP(ev => device.onConnectionRequest(ev))` → `.then(conn => { device.setConnectionRequestURL(conn.url); device.start() })`. Keeps CR-cred sync listeners. This class becomes the fleet.
- `src/cwmp-device.ts` — self-running CPE. Public hooks the fleet needs: `start()`, `onConnectionRequest(event)`, `stop()`, `getCrCredentials()`, `setConnectionRequestURL(url)`, `configureManagementServer(cfg)`. Identity (`_serialNumber`/`_oui`/`_mac`) set from `options` in the constructor; `_rootName`; tree built from `defaultTR98/181`.
- `src/config/parser.ts` — `buildOptions` walks `configFields` then **post-processes `{i}` templating** on `device.serialNumber/oui/mac` using `device.index`. This resolves to ONE identity → must move (Decision 5).
- `src/config/template.ts` — `applyTemplate(value, index)` (`{i}`/`{i:04}`/`{i+N}`/`{i:02x}`). Reused at device construction.
- `src/config/fields.ts` — declarative field registry (`path`/`env`/`flag`/`default`/`parse`, `asInt`/`asString`). New `count`/`bootDelay` fields go here.
- `main.ts` — single device: `buildOptions` → `new CWMPSimulator(options)` → `start()`.
- `src/types.ts` — `CwmpSimulatorOptions { device, conn, acs, log? }`; `CwmpDeviceOptions` has `index?`, no fleet section.
- `F:/github/genieacs-sim` (reference) — fork-per-device via `cluster.fork(env)`, one CSV model per run, base-MAC/serial + index identity, staggered `setTimeout(1000 + i*wait)`, auto-restart on exit. Confirms the identity+stagger pattern; we deliberately go **in-process** instead.

### Searches performed

- `req.url` routing in `cwmp-conn.ts` → only the `!== '/'` 404 guard; no path parsing today.
- `getCrCredentials` consumers → none yet (added in the self-ownership step for exactly this).

### Runtime path (target)

```
buildOptions (raw patterns + index + count) → CWMPSimulator(fleet)
   builds N devices (index base..base+N-1; each resolves its own {i} identity)
   → one shared CWMPConn.listenHTTP() (IP probe once, base url)
   → for each device: hash = md5(serial)[:8]; conn.register(hash, device); device.setConnectionRequestURL(baseUrl + hash); setTimeout(device.start(), i*bootDelay)
incoming CR: CWMPConn handler → device = registry.get(path) → auth via device.getCrCredentials() → device.onConnectionRequest()
```

### Existing patterns to reuse

- `src/config/fields.ts` field objects (`asInt`) for `count`/`bootDelay`.
- `md5()` in `cwmp-conn.ts` for the hash path.
- The device's `start()`/`onConnectionRequest()`/`getCrCredentials()` surface (already built).

### Gaps

- `CWMPConn` is single-path/single-callback/single-credential.
- `{i}` resolves once in `buildOptions` (can't feed N identities).
- No `count`/`bootDelay` config; no fleet section in options.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | CR path = **short hash of serial** (`md5(serial)` → first 8 hex), URL `http://addr:port/{hash}`. Deterministic + opaque + stable across restarts. | User answer (CR path). |
| 2 | **`CWMPSimulator` becomes the fleet** — holds `_devices: CWMPDevice[]` (1..N) + one shared `CWMPConn`. Single device = fleet of one. Stays the exported lib entry. | User answer (Orchestrator). |
| 3 | **Staggered boot in scope** — `fleet.bootDelay` ms between each `device.start()`. | User answer (Stagger); folds PENDING #3. |
| 4 | Scope = **`--count N`, same model**. Multiple templates = a later fleet plan; loading from files = later. | User answer (Fleet source). |
| 5 | **`{i}` templating moves to device construction.** `buildOptions` keeps raw patterns + `index` + `count`; each `CWMPDevice` resolves `serial/oui/mac` from its own `index` via `applyTemplate`. | User answer (Templating). |
| 6 | Per-device **credentials** (via `device.getCrCredentials()`); **authMode stays server-level** (`conn.authMode`). | `(defaulted: creds differ per device; auth scheme is a server setting)`. |
| 7 | One shared IP probe + one listener (the existing `listenHTTP` probe runs once). | `(defaulted: code evidence — one server)`. |
| 8 | `count N` → device indices `baseIndex .. baseIndex+N-1` (`baseIndex` = `device.index`, default 0). | `(defaulted: obvious mapping)`. |

## Proposed architecture

- **Types** (`src/types.ts`): `CwmpFleetOptions { count?: number; bootDelay?: number }`; add `fleet?` to `CwmpSimulatorOptions`.
- **Config** (`src/config/`): add `fleet.count` (`FLEET_COUNT`/`--count`, default 1) and `fleet.bootDelay` (`FLEET_BOOT_DELAY`/`--boot-delay`, default 1000) to `fields.ts`; **remove** the templating post-process from `parser.ts`.
- **Device** (`src/cwmp-device.ts`): resolve identity from `options.index` in the constructor (`applyTemplate(serial/oui/mac, index)`).
- **CWMPConn** (`src/cwmp-conn.ts`): `_devices: Map<string, CWMPDevice>` registry; `register(hash, device)` / `unregister(hash)`; `listenHTTP()` binds + routes by path (no callback); `handleRequest(req, res, device)` auth via the device's creds; exported `hashConnectionPath(serial)`.
- **CWMPSimulator** (`src/cwmp-sim.ts`): build N devices, own the shared `CWMPConn`, register hashes, set per-device CR URLs, staggered `start()`, `stop()` all.
- **Source-of-truth files:** options = `src/types.ts`; CR routing = `src/cwmp-conn.ts`.

## Phases

### Phase 1 — Identity-at-construction + fleet config

**Objective:** Devices resolve their own `{i}` identity from their index; `--count`/`--boot-delay`
parse into options. **Validation:** `npm run check`, `npm test` (updated P3/config tests).

#### Task: Move `{i}` resolution into the device

- **Layer:** device + config.
- **Files:** `UPDATE: src/config/parser.ts` (remove the `for (const key of ["serialNumber","oui","mac"]) … applyTemplate` post-process block); `UPDATE: src/cwmp-device.ts` (resolve in constructor).
- **Reason:** A fleet needs N identities from the raw pattern (Decision 5).
- **Code:**
  ```ts
  // src/cwmp-device.ts — import applyTemplate, then in the constructor:
  import { applyTemplate } from "./config/template.ts";
  const idx = options.index ?? 0;
  this._serialNumber = applyTemplate(options.serialNumber || "123456", idx);
  this._oui = applyTemplate(options.oui || "000000", idx);
  if (options.mac) this._mac = applyTemplate(options.mac, idx);
  ```
- **Integration points:** `defaultTR98/181` already read `this._serialNumber`/`_oui`; `applyMac` reads `this._mac` — all downstream of this resolution.
- **Validation:** `new CWMPDevice({ serialNumber: "SIM-{i}", index: 5 }).getValue("Device.DeviceInfo.SerialNumber") === "SIM-5"`.

#### Task: Fleet option types + config fields

- **Layer:** types + config.
- **Files:** `UPDATE: src/types.ts`; `UPDATE: src/config/fields.ts`.
- **Code:**
  ```ts
  // types.ts
  export type CwmpFleetOptions = { count?: number; bootDelay?: number };
  // … add  fleet?: CwmpFleetOptions  to CwmpSimulatorOptions
  // fields.ts
  { path: "fleet.count", env: "FLEET_COUNT", flag: "--count", label: "Number of devices to simulate", default: 1, parse: asInt },
  { path: "fleet.bootDelay", env: "FLEET_BOOT_DELAY", flag: "--boot-delay", label: "Delay (ms) between device boots", default: 1000, parse: asInt },
  ```
- **Validation:** `buildOptions({}, ["--count","3"]).fleet.count === 3`; `buildOptions({}, ["--serial","SIM-{i}"]).device.serialNumber === "SIM-{i}"` (raw, no longer resolved).

#### Task: Update affected tests

- **Layer:** tests.
- **Files:** `UPDATE: test/config.test.ts` (the buildOptions-resolves-templating assertions → assert raw passthrough + `fleet.count`); `UPDATE: test/cwmp-device.test.ts` (add identity-resolution test).
- **Validation:** `npm test` green.

**Expected result:** identity is per-device; fleet knobs parse. No fleet behavior yet.

### Phase 2 — Shared CR server routing + fleet orchestration

**Objective:** One `CWMPConn` routes `/{hash}` to the right device; `CWMPSimulator` runs N devices with
staggered boot. **Validation:** `npm run check`, `npm test`, fleet smoke (N distinct Informs).

#### Task: Make `CWMPConn` multi-device

- **Layer:** CR server.
- **Files:** `UPDATE: src/cwmp-conn.ts`.
- **Reason:** Route by path, authenticate per device, drop the single-callback model.
- **Integration points:** `listenHTTP()` keeps the IP probe + base-URL resolve, but the request handler looks the device up in `_devices` by the URL path and calls `device.onConnectionRequest()`.
- **Code:**
  ```ts
  import type CWMPDevice from "./cwmp-device.ts";   // type-only (avoid cycle)
  export function hashConnectionPath(serial: string): string {
    return md5(serial).slice(0, 8);
  }
  // class fields:
  _devices: Map<string, CWMPDevice> = new Map();
  register(hash: string, device: CWMPDevice) { this._devices.set(hash, device); }
  unregister(hash: string) { this._devices.delete(hash); }
  // in the request handler (replaces the `req.url !== '/'` guard):
  const path = (req.url || "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const device = this._devices.get(path);
  if (!device) { res.writeHead(404); res.end(); return; }
  this.handleRequest(req, res, device);
  // handleRequest(req, res, device): auth against device.getCrCredentials() (+ this._options.authMode),
  // then device.onConnectionRequest("6 CONNECTION REQUEST");
  ```
- **Validation:** registry-routing unit test (below).

#### Task: Make `CWMPSimulator` the fleet

- **Layer:** orchestrator.
- **Files:** `UPDATE: src/cwmp-sim.ts`.
- **Reason:** Build/own N devices + the shared server (Decision 2).
- **Code:**
  ```ts
  // constructor: build N devices
  const count = Math.max(1, options.fleet?.count ?? 1);
  const baseIndex = options.device.index ?? 0;
  this._devices = [];
  for (let i = 0; i < count; i++) {
    const device = new CWMPDevice({ ...options.device, index: baseIndex + i, logger: this._log });
    device.configureManagementServer({ acsUrl: options.acs.url, acsUser: options.acs.user, acsPass: options.acs.pass, crUser: options.conn.user, crPass: options.conn.pass });
    this._devices.push(device);
  }
  // start(): one shared server, register + stagger
  this._connectRequestServer = new CWMPConn(this._options.acs.url, this._options.conn, this._log);
  this._connectRequestServer.listenHTTP().then((connection) => {
    const delay = this._options.fleet?.bootDelay ?? 1000;
    this._devices.forEach((device, i) => {
      const hash = hashConnectionPath(device.getValue(`${device._rootName}.DeviceInfo.SerialNumber`));
      this._connectRequestServer!.register(hash, device);
      device.setConnectionRequestURL(`${connection.url}${hash}`);
      setTimeout(() => device.start(), i * delay);
    });
  }).catch((err) => this._log.error(`Failed to start connection server: ${err.message}`));
  // stop(): this._devices.forEach(d => d.stop()); this._connectRequestServer?._server?.close();
  // keep `_device` getter (= _devices[0]) for back-compat with existing tests/CLI SIGINT.
  ```
- **Integration points:** `main.ts` SIGINT uses `client._device` → keep a `get _device()` returning `_devices[0]`. CR-cred sync listeners now attach per device.
- **Validation:** fleet smoke + unit test.

#### Task: CLI summary + tests + validation

- **Layer:** CLI + tests.
- **Files:** `UPDATE: main.ts` (show count when > 1); `CREATE: test/cwmp-conn.test.ts` (hash determinism; `register` + route → `onConnectionRequest`; unknown path → 404); `UPDATE: test/`… (fleet builds N devices with distinct serials).
- **Code:**
  ```ts
  // test/cwmp-conn.test.ts (sketch)
  test("routes a registered hash to its device", () => {
    const conn = new CWMPConn("http://acs/", { authMode: "none" } as any);
    let hit = ""; const dev = { onConnectionRequest: () => (hit = "yes"), getCrCredentials: () => ({ user: "", pass: "" }) } as any;
    conn.register(hashConnectionPath("SIM-1"), dev);
    // simulate handler lookup → device found, no creds → onConnectionRequest
  });
  ```
- **Validation:** `npm run check`; `npm test`; smoke: `--count 3` against a mock ACS → 3 Informs with serials `SIM-0/1/2`, each CR URL `…/{hash}` distinct; unknown path → 404.

**Expected result:** `--count N` runs N path-routed, staggered, self-running devices behind one server.

## Risks & tradeoffs

- **Single-device CR URL changes** from `…/` to `…/{hash}` — harmless (the ACS uses whatever `ConnectionRequestURL` the device reports), but note it.
- **One event loop** for N devices — fine for hundreds (I/O-bound); fork is a future escape hatch for thousands. Document the practical ceiling, don't cap silently.
- **`hashConnectionPath` collisions** — `md5[:8]` is ~4B space; fine for fleets of thousands. If two configured serials collide, the later `register` wins — log a warning on collision.
- **Templating move** changes `buildOptions`' intermediate output (P3 test moves) — end device identity is unchanged.

## Resume state

- **Phase 1 ✅** — `{i}` templating moved from `config/parser.ts` into the `CWMPDevice` constructor (resolves `serial`/`oui`/`mac` from `options.index`, default 0); `buildOptions` keeps raw patterns. `CwmpFleetOptions {count, bootDelay}` + `fleet?` on `CwmpSimulatorOptions`; config fields `fleet.count` (`--count`, default 1) + `fleet.bootDelay` (`--boot-delay`, default 1000). Tests updated (config raw-passthrough + `fleet.count`; device identity resolution). Incidental: typed `toInternalModel(): Record<string,any>` (surfaced when tsconfig added `test/**/*`), and added `tsconfig.build.json` so `build` no longer emits `dist/test/` (the tsconfig test-include is for `check` only). **101 tests pass, `npm run check` clean, build emits only `main`+`src`.**
- **Phase 2 ✅** — `CWMPConn` is now a **device-agnostic** shared server: registry of `CrRoute` callbacks (`credentials()` + `onRequest()`), path routing (`/{hash}` → route, unknown → 404), per-route auth (`route.credentials()`). `CWMPSimulator` builds/owns N devices, registers each via callbacks, sets per-device CR URLs (`base + device.getConnectionHash()`), staggered `start()`, `stop()` all; `_device` is a back-compat getter for `_devices[0]`. **Improvements made during implementation:** (a) per-device auth via `getCrCredentials()` made the old `_options.conn` cred-sync listeners obsolete — removed; (b) the hash moved into the device as cached `getConnectionHash()` (CWMPConn no longer knows about devices — per user feedback); (c) **fixed a pre-existing CR-server bug** — `listenHTTP` bound on `egressLocalPort - 1` (collision-prone `EADDRINUSE`) instead of the configured port, and crashed on bind error; now binds the configured port and rejects gracefully. Tests: `test/cwmp-conn.test.ts` (routing/auth/lazy-creds), `test/fleet.test.ts` (N devices, distinct identities, ACS config), device `getConnectionHash`. **112 tests pass, `npm run check` clean.** Smoke: `--count 2` → 2 distinct Informs (`SIM-0`/`SIM-1`) reach a mock ACS.
- **Next action:** None — shipped. Follow-ons: device **templates** (Plan B, our CSV/JSON loader) and per-device **state** persistence (Plan C).
- **Open questions:** None.
- **Watch out for:** `CWMPConn` is intentionally device-free — keep it that way (register routes/callbacks, not devices). Single-device CR URL now carries a `/{hash}`.

## Final verification checklist

- [x] `npm run check` clean; `npm test` green (112; updated P3/config tests + new conn/fleet tests).
- [x] `--count N` boots N devices with serials `SIM-0..N-1` (templated), staggered by `--boot-delay` (smoke: count 2 → distinct Informs).
- [x] Each device's `ConnectionRequestURL` is `http://addr:port/{hash}` and distinct; routing → only that route; unknown path → 404.
- [x] Per-route CR auth uses the route's `credentials()` (backed by `device.getCrCredentials()`).
- [x] Single-device (`--count 1`) still works (fleet of one); `client._device` back-compat intact.
- [x] Status synced: this header, `00-fleet.md`, `index.md`.
