<!--
Domain: fleet
Status: ⚪ Not started
Priority: High
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: fleet/01 (🟢 runtime), fleet/02 (🟢 models), fleet/03 (🟢 state + event bus)
Reference: ./00-fleet.md
-->

# FLEET-04 — Dynamic fleet control + lifecycle event bus

_Status: ⚪ Not started · Priority: High · Created: 2026-06-16_

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

### Phase 1 — Control API: group registry, handles, remove/restart

**Objective:** add/remove/restart groups and devices at runtime. **Validation:** add → handle.devices; remove → stopped, CR-unregistered, dropped, `device:remove` fired; restart → reboots; index stays monotonic.

- **`src/types.ts`** — `FleetGroupHandle`.
- **`src/cwmp-sim.ts`** — `_groups` + `_nextGroupId`; `addGroup` returns a handle (tracks, emits `device:add`); `removeGroup(id)`/`removeDevice(device)` (save-if-dirty → `stop` → `unregister` CR if listening → `device:remove` → splice from `_devices` + group); `restartGroup(id)`/`rebootDevice(device)` (`stop`+`start("1 BOOT")`); handle `.remove()`/`.restart()` delegate.
- **Tests:** `test/dynamic.test.ts` — `addGroup` → handle `{id, devices, remove, restart}`; `removeGroup` drops devices + emits `device:remove` (+ saves a dirty one); `removeDevice`; `restartGroup`/`rebootDevice` call through; index monotonic across remove+add; `addGroup` mid-run registers a CR route (when started).
- **Note:** update `test/fleet.test.ts` "addGroup is reusable" → assert on `handle.devices`.

### Phase 2 — Lifecycle event bus

**Objective:** the simulator emits `device:boot`/`device:session`/`device:inform`/`device:diagnostic`. **Validation:** each device hook fires the forwarded `device:*` event with the right payload.

- **`src/cwmp-device.ts`** — emit `boot` (in `start`), `session` start (in `startSession`) + reuse `session-end` as `session` end, `inform` (event code, in `startSession`), `diagnostic` (type+phase, in `runTask` start / `finishTask` end). Keep the internal `session-end` auto-save contract.
- **`src/cwmp-sim.ts`** — `_wireDeviceEvents` forwards the new device events as `device:*` (with payloads: device, + phase/eventCode/type).
- **Tests:** `test/dynamic.test.ts` — emit each device event (directly or via the hook) → assert the forwarded `device:*` with payload; `device:session` fires `start` then `end`; auto-save on session end still works.
- **`PENDING.md`** — note dynamic control + event bus shipped; cross-ref #16.

## Risks & tradeoffs

- **Remove/restart mid-session.** A device's async session chain (or an in-flight CR request) may still resolve after `stop()`. `stop()` clears timers + the HTTP client; a late response should no-op. Guard against acting on a removed device; note any stray logs.
- **Event volume.** `device:inform` fires per device per periodic inform — fine (opt-in listeners), but a dashboard should batch/throttle. Document.
- **Diagnostic event coverage.** `finishTask` already distinguishes `diag-*`/`task-*`; the *start* edge is at `runTask`. Map task types → friendly `{ ping, traceroute, download, upload, transfer }` names; a test asserts one full start→end pair.
- **Handle staleness.** After `removeGroup`, its handle is dead — methods become no-ops (group not in registry). Document.
- **Scope.** This plan is the **API + events** only. The **#16 dashboard** (HTTP/WS server + UI) is its own plan that consumes this.

## Resume state

- **Done so far:** Plan written; 6 decisions locked (Gate 2 answered). No code.
- **Next action:** Phase 1 — `FleetGroupHandle` + `_groups` registry + `addGroup` handle return + `removeGroup`/`removeDevice`/`restartGroup`/`rebootDevice` + `device:add`/`device:remove`, with `test/dynamic.test.ts`.
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
