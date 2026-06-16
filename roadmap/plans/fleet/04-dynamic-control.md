<!--
Domain: fleet
Status: 🟢 Shipped
Priority: High
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: fleet/01 (🟢 runtime), fleet/02 (🟢 models), fleet/03 (🟢 state + event bus)
Reference: ./00-fleet.md
-->

# FLEET-04 — Dynamic fleet control + lifecycle event bus

_Status: 🟢 Shipped (Phases 1–2) · Priority: High · Created: 2026-06-16_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-fleet.md, and ../index.md. -->

## Goal

Make a running fleet **controllable and observable** at runtime: add device groups, remove them, reboot
them — and a broad **`device:*` event bus** a UI can subscribe to. This is the keystone the **#16
dashboard** consumes (start/stop devices, trigger informs, watch live activity over a WebSocket).

Everything is built on what fleet/01–03 already shipped: `CWMPSimulator.addGroup()` (the seam, which
already registers + boots when the fleet is live), `CWMPConn.register/unregister` (runtime CR routing),
and the `device:save`/`device:load` bus on the simulator. The library stays **I/O-free** — a runtime
`addGroup` takes a `FleetGroup` whose `model` is already a loaded object (the caller/dashboard loads it).

## Reconnaissance

### Files read / searched

- `src/cwmp-sim.ts` — `CWMPSimulator extends EventEmitter`; `addGroup(group)` builds devices, `_wireDeviceEvents` forwards `save`/`load`, `_registerAndBoot` (register CR route + boot), `_applyLoadedState`, `saveAll`, `start`, `stop`. **`addGroup` returns `CWMPDevice[]` but tracks no group membership** — runtime remove/restart needs a group registry. `_nextIndex` is monotonic. `_connection`/`_connectRequestServer` available once started.
- `src/cwmp-conn.ts` — `register(hash, route)` / **`unregister(hash)`** already exist; the server is device-agnostic (routes by path). Removing a device = `unregister(device.getConnectionHash())`.
- `src/cwmp-device.ts` — `_events` emitter (currently `save`/`load`/`session-end`); lifecycle hooks to emit from: `start(event)` (boot), `startSession(event)` (session begin + the Inform event code), `handleMethod` empty-body (already `session-end`); `addTask`/`runTask`/`finishTask` (diagnostic + transfer lifecycle — `finishTask` already switches on `diag-*` / `task-*` types). `stop()` clears the periodic timer + tears down the HTTP client; `start()` lazily rebuilds it → **reboot = `stop()` then `start("1 BOOT")`**.

### Existing patterns to reuse

- `_wireDeviceEvents` (forward device events → `device:*`); extend it.
- `CrRoute` register/unregister for CR lifecycle.
- The dirty flag + `saveState()` (save on remove, like `stop()` already does).

### Gaps

- No group registry / handles; no remove/restart/per-device control.
- Event bus is only `save`/`load` — no `add`/`remove`/`boot`/`session`/`inform`/`diagnostic`.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **`addGroup` returns a `FleetGroupHandle`** `{ id, devices, remove(), restart() }`; the simulator tracks a `_groups` registry by id. `removeGroup(id)` / `restartGroup(id)` also exist. | User answer (Group handle). |
| 2 | **Group + per-device control**: `removeGroup`/`restartGroup` and `removeDevice(device)`/`rebootDevice(device)`. | User answer (Granularity). |
| 3 | **Event bus** (on the simulator, forwarded from each device's `_events`): existing `device:save`/`device:load` + **`device:add`**, **`device:remove`**, **`device:boot`**, **`device:session`** (phase `start`/`end`), **`device:inform`** (with event code), **`device:diagnostic`** (type + phase `start`/`end`, covering ping/traceroute/download/upload + transfers). | User answer (Events, incl. diagnostics for a future dashboard WS). |
| 4 | **Restart = reboot in place**: `stop()` then `start("1 BOOT")` — the device re-Informs, keeps accumulated/persisted state and its CR registration (like a real CPE reboot). | User answer (Restart). |
| 5 | **Remove = graceful teardown**: save-if-dirty (emit `device:save`) → `stop()` session → `unregister` CR route → `device:remove` → drop from `_devices` + its group. **Index stays monotonic** (removed indices are never reused). | `(defaulted: clean teardown; monotonic avoids identity reuse)`. |
| 6 | **Library stays I/O-free**: runtime `addGroup` takes a `FleetGroup` with a pre-loaded `model` object — the caller (dashboard/CLI) reads the file. | fleet/02–03 boundary. |

## Proposed architecture

```
CWMPSimulator (EventEmitter)
  _groups: Map<id, { id, devices }>      _nextGroupId
  addGroup(group) → FleetGroupHandle     // tracks + wires + emits device:add; boots if live
  removeGroup(id) / handle.remove()      // per device: save-if-dirty → stop → CR unregister → device:remove
  restartGroup(id) / handle.restart()    // per device: stop → start("1 BOOT")  (device:boot)
  removeDevice(device) / rebootDevice(device)
  _wireDeviceEvents(device)              // forwards boot/session/inform/diagnostic/save/load → device:*

CWMPDevice (_events)
  start()        → emit "boot"
  startSession() → emit "session"(start) + "inform"(eventCode)
  handleMethod() → emit "session"(end)        (was "session-end"; keep auto-save)
  runTask()/finishTask() → emit "diagnostic"(type, start|end)
```

- **`src/types.ts`:** `FleetGroupHandle = { id: string; devices: CWMPDevice[]; remove(): void; restart(): void }`.
- **`src/cwmp-sim.ts`:** registry + handle + remove/restart + per-device + `device:add`/`device:remove`; extend `_wireDeviceEvents`.
- **`src/cwmp-device.ts`:** emit `boot`/`session`/`inform`/`diagnostic` at the hooks above.
- **Source of truth:** control API on the simulator class; events documented in one place (a `DEVICE_EVENTS` list / JSDoc).

## Phases

### Phase 1 — Control API: group registry, handles, remove/restart — 🟢 SHIPPED

**Objective:** add/remove/restart groups and devices at runtime. **Validation:** add → handle.devices; remove → stopped, CR-unregistered, dropped, `device:remove` fired; restart → reboots; index stays monotonic. ✅ 9 tests (`test/dynamic.test.ts`); full suite **167 green**; `tsc` clean.

- [x] **`src/cwmp-sim.ts`** — exported `FleetGroupHandle` (kept here, not `types.ts`, since it references the `CWMPDevice` class); `_groups` registry + `_nextGroupId`; `addGroup` returns a handle (tracks, emits `device:add`); `removeGroup(id)`/`removeDevice(device)` (save-if-dirty → `stop` → `unregister` CR when listening → splice from `_devices` + group → `device:remove`); `restartGroup(id)`/`rebootDevice(device)` (`stop`+`start("1 BOOT")`); handle `.remove()`/`.restart()` delegate.
- [x] **Tests:** `test/dynamic.test.ts` — handle shape; runtime `device:add`; `removeGroup`/`removeDevice` drop + `device:remove` + dirty-save + unregister-no-throw + unknown-id no-op; `rebootDevice`/`restartGroup` call `stop`+`start("1 BOOT")` (stubbed, no network); monotonic index across remove+add.
- [x] **`test/fleet.test.ts`** "addGroup is reusable" → asserts on `handle.devices`.

**Note:** `FleetGroupHandle` lives in `src/cwmp-sim.ts` (not `src/types.ts` as first planned) to avoid a `types.ts → CWMPDevice` import cycle.

### Phase 2 — Lifecycle event bus — 🟢 SHIPPED

**Objective:** the simulator emits `device:boot`/`device:session`/`device:inform`/`device:diagnostic`. **Validation:** each device hook fires the forwarded `device:*` event with the right payload. ✅ 5 tests; full suite **172 green**; `tsc` clean.

- [x] **`src/cwmp-device.ts`** — emits `boot` (in `start`), `session-start` + `inform` (event code, in `startSession`), keeps `session-end` (in `handleMethod`), `diagnostic` (friendly type + phase, in `addTask` start / `finishTask` end via a `TASK_NAMES` map: ping/traceroute/download/upload/wifi/transfer).
- [x] **`src/cwmp-sim.ts`** — `_wireDeviceEvents` forwards `boot`→`device:boot`, `inform`→`device:inform`(code), `session-start`→`device:session`("start",code), `session-end`→`device:session`("end") **+** the dirty-gated auto-save, `diagnostic`→`device:diagnostic`(type,phase).
- [x] **Tests:** `test/dynamic.test.ts` — forwarding of all `device:*` with payloads; `device.start()`→boot; `startSession()`→session-start+inform; `addTask`/`finishTask`→diagnostic start/end (friendly type); `session-end` still auto-saves.

**Design note:** the device uses separate `session-start`/`session-end` events (not a generic `session` with a phase param) — the simulator unifies them into `device:session` with a `"start"`/`"end"` phase. `diagnostic` start fires at `addTask` (one per request) and end at `finishTask` (one per completion) — unambiguous, avoiding the `runTask` queue-processing edge.

## Risks & tradeoffs

- **Remove/restart mid-session.** A device's async session chain (or an in-flight CR request) may still resolve after `stop()`. `stop()` clears timers + the HTTP client; a late response should no-op. Guard against acting on a removed device; note any stray logs.
- **Event volume.** `device:inform` fires per device per periodic inform — fine (opt-in listeners), but a dashboard should batch/throttle. Document.
- **Diagnostic event coverage.** `finishTask` already distinguishes `diag-*`/`task-*`; the *start* edge is at `runTask`. Map task types → friendly `{ ping, traceroute, download, upload, transfer }` names; a test asserts one full start→end pair.
- **Handle staleness.** After `removeGroup`, its handle is dead — methods become no-ops (group not in registry). Document.
- **Scope.** This plan is the **API + events** only. The **#16 dashboard** (HTTP/WS server + UI) is its own plan that consumes this.

## Resume state

- **Done:** **Both phases 🟢 shipped.** P1 control API (handles, registry, remove/restart, per-device, `device:add`/`device:remove`, monotonic index). P2 lifecycle bus (`device:boot`/`session`(start,end)/`inform`(code)/`diagnostic`(type,phase) + existing `save`/`load`). `test/dynamic.test.ts` (14 tests); full suite **172 green**; `tsc` clean.
- **Next action:** none for fleet/04. The bus + control API are the foundation for **#16 dashboard** (HTTP/WS server + UI consuming `device:*` and calling `addGroup`/`removeGroup`/`restartGroup`). Optional later: throttle/batch `device:inform` for the dashboard; the AddObject state round-trip refinement (fleet/03 risk).
- **Open questions:** None.
- **Watch out for:** keep `addGroup`'s existing "running → register + boot" path working; `removeDevice` must `unregister` the CR route only when the server is listening; keep the `session-end` → auto-save contract intact when renaming/extending session events.

## Final verification checklist

- [ ] `npm run check` clean; `npm test` green (`test/dynamic.test.ts` + updated fleet test).
- [ ] `addGroup` returns `{ id, devices, remove(), restart() }`; simulator tracks groups by id.
- [ ] `removeGroup`/`removeDevice`: save-if-dirty, stop, CR-unregister (when live), `device:remove`, dropped; index monotonic.
- [ ] `restartGroup`/`rebootDevice`: reboot in place (`device:boot`), state + CR registration preserved.
- [ ] Bus emits `device:add`/`remove`/`boot`/`session`(start,end)/`inform`(code)/`diagnostic`(type,phase) + existing `save`/`load`.
- [ ] Library still imports no `fs`/`os`; runtime `addGroup` takes a pre-loaded `model`.
- [ ] Status synced: this header, `00-fleet.md`, `index.md`.
