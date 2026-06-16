<!--
Domain: fleet
Status: 🟢 Shipped
Priority: High
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: fleet/02 (🟢 device models), fleet/01 (🟢 multi-device runtime)
Reference: ./00-fleet.md
-->

# FLEET-03 — Per-device state persistence + save/load events

_Status: 🟢 Shipped (Phases 1–3) · Priority: High · Created: 2026-06-16_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-fleet.md, and ../index.md. -->

## Goal

Make a simulated device **remember what the ACS changed** across restarts. After an ACS sets parameters
(SetParameterValues), adds objects, or changes the periodic-inform interval, that state should survive a
stop/start so the device re-informs with its real, evolved values — like a physical CPE with NVRAM.

This completes the layering from fleet/01–02: **Model** (device type) → **State** (per-device persisted
values) → **Identity** (`{i}`) → **Runtime**. fleet/02 gave us Model + Identity; this adds **State**.

Two firm constraints from the design discussion:
1. **The library stays IO-free** (it lost `fs` in fleet/02 — keep it that way). The lib *serializes* state
   and *emits events*; it never reads/writes files. Persistence is **BYO** via `device:save` / `importState`.
2. **The CLI binary** provides convenience file storage under `--storage-dir` (default `~/.cwmp-sim/devices/`),
   keyed by serial — all filesystem I/O lives in the CLI/config layer.

## Reconnaissance

### Files read / searched

- `src/cwmp-params.ts` — owns `_rootTree`; **`getLeaves(path) → {name,value,type,writable}[]`** already walks the
  tree and is the serialization primitive. Every mutation (`set`/`addObject`/`deleteObject`) calls the injected
  `_onChange(event,path,data)` — a single chokepoint to flip a **dirty** flag.
- `src/cwmp-device.ts` — the `_onChange` handler is `(event,path,data) => { if (!this._keepEvents) this.fireEvent(...) }`
  (constructor). Device has a **path-keyed** listener map (`addListener`/`fireEvent`) for param changes — *not* a
  lifecycle event bus. `applyIdentity()` force-sets SerialNumber/ManufacturerOUI (read-only); `set(path,val,true)`
  force-creates+writes. No `fs` (IO-free since fleet/02). Serial is `this._serialNumber` (resolved `{i}`).
- `src/cwmp-sim.ts` — `CWMPSimulator` builds devices via `addGroup()`; `start()` boots them (staggered),
  `stop()` tears down. **Not** an EventEmitter today. Exposes `_devices` (+ `_device`).
- `src/cwmp-methods.ts` — SPV writes via `device.set`; AddObject/DeleteObject via `device.addObject/deleteObject`;
  `SetParameterAttributes` stores into `device._parameterAttributes`; ParameterKey lives in `ManagementServer.ParameterKey`.
- `main.ts` — thin CLI: `resolveModels(buildOptions(...))` → `new CWMPSimulator` → `start()`; SIGINT → `client.stop()`.
- `src/config/{fields,parser}.ts` — declarative registry; global vs group `scope`. New global field: `--storage-dir`.
- No existing `state`/`persist`/EventEmitter code anywhere (grep) — this is additive.

### Existing patterns to reuse

- `getLeaves()` for serialization; `set(path,val,true)` for restore.
- The `_onChange` chokepoint for dirty-tracking.
- The injected-callback decoupling (CrRoute, `_onChange`) — load/save stay lib-pure, IO injected by the CLI.
- `config/models.ts`'s `resolveModels` shape — a config-layer step that prepares per-device data before the
  sync constructors.

### Gaps

- No state serialization (`exportState`/`importState`), no dirty flag.
- No lifecycle event bus (`device:save`/`device:load`); simulator isn't an emitter.
- No CLI storage (`--storage-dir`, `~/.cwmp-sim/devices/`, read-on-boot / write-on-save).

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **Persist writable leaves only** — `getLeaves` filtered to `writable === true`, plus param attributes + `ParameterKey`. Read-only/structural params come deterministically from the model. JSON, keyed by parameter path. | User answer (What to persist). |
| 2 | **Save triggers: graceful stop + after each CWMP session (when dirty) + an always-available explicit API** (`device.saveState()` / `simulator.saveAll()`). **Not** debounced-on-change. A **dirty flag** (set via `_onChange`, cleared on save) gates auto-saves and tells the API there's pending state. | User answer (Save trigger) + clarification ("plus API, not only"; "need a pending state"). |
| 3 | **Library is IO-free; persistence is BYO via events.** Lib emits **`device:save`** (push, with serialized state) and applies **`device.importState(state)`** (load); it never touches the filesystem. The **CLI** wires convenience file storage. | User answer (Event-only / BYO) + the fleet/02 IO-free principle. |
| 4 | **CLI convenience store** under **`--storage-dir`** (default **`~/.cwmp-sim/devices/`**, `~` via `os.homedir()`), one file **`<serial>.json`** per device. All file I/O lives in the CLI/config layer. | User answer ("main.ts is a binary and could write to ~/.cwmp-sim"; "add storage-dir for convenience"). |
| 5 | **Events live on `CWMPSimulator`** (the `client`): `device:save(device, state)`, `device:load(device, state)` — via Node's built-in `node:events` (zero new dep). Bus is **extensible** (future `device:session`, `device:boot`). Device emits lifecycle internally; the simulator forwards namespaced. | User vision (`client.on('device:save'…)`, `device:xxx`). |
| 6 | **Load = pull at boot.** Saved state is applied **after** model + `ensureRequiredNodes` + `applyIdentity`, via force-`set`, so the ACS's writable values win; read-only identity (serial/OUI) is untouched (not in writable state). Load + `device:load` fire at **`start()`/boot**, not construction, so listeners attached after `new CWMPSimulator` observe them. | Correct layering + event-timing (construction predates listener wiring). |
| 7 | **State keyed by serial.** Serial is the device's stable identity (already the CR-hash seed); the storage filename is `<serial>.json`. | Stable per-unit key. |

## Proposed architecture

```
LIBRARY (IO-free)                              CLI BINARY (all file I/O)
─────────────────                              ────────────────────────
CWMPDevice                                     main.ts + config
  _dirty (set by _onChange, cleared on save)     --storage-dir ~/.cwmp-sim/devices/
  exportState(): SavedState   ← writable leaves  on boot, per device:
  importState(state)          ← force-set          read <storage-dir>/<serial>.json → device.importState
  emits 'save' (dirty: stop / session-end)       client.on('device:save', (d,state) =>
  emits 'load' (after importState)                 writeFile(<serial>.json, state))   ← BYO storage
                                                 SIGINT → client.stop() → saves flush
CWMPSimulator extends event bus
  forwards device 'save'/'load' as
    'device:save' / 'device:load'
  saveAll(); save-on-stop; save-after-session
```

`SavedState` (JSON): `{ "params": { "<path>": { "value": "...", "type": "xsd:..." }, … }, "attributes": { "<path>": {notification, accessList} }, "parameterKey": "..." }`
(params = writable leaves; type kept so force-restore of AddObject'd instance leaves is faithful.)

- **`src/cwmp-device.ts`:** `_dirty`; `exportState()` (filter `getLeaves(root)` to writable + attrs + ParameterKey);
  `importState(state)` (force-`set` each, restore attrs/ParameterKey, emit `load`); lifecycle emitter; mark dirty in `_onChange`.
- **`src/cwmp-sim.ts`:** become an event emitter; forward device `save`/`load`; `saveAll()`; hook stop + session-end.
- **`src/config/fields.ts`:** global `--storage-dir` (default `~/.cwmp-sim/devices`).
- **`main.ts`:** resolve `~`; on boot read each device's `<serial>.json` → `importState`; `client.on('device:save', write)`.
- **Source of truth:** state shape lives in `types.ts` (`SavedState`); the lib defines behavior, the CLI defines storage.

## Phases

### Phase 1 — Lib: serialize + dirty + lifecycle events — 🟢 SHIPPED

**Objective:** a device can export/import its writable state and signals save/load. **Validation:** mutate → export → new device → import → values match; dirty flips on change, clears on save. ✅ 10 new tests (`test/state.test.ts`); full suite **147 green**; `tsc` clean.

- [x] **`src/types.ts`** — `SavedState` (`{ params: { <path>: {value,type} }, attributes? }`).
- [x] **`src/cwmp-device.ts`** — `_dirty` (set in the `_onChange` chokepoint, cleared at boot in `start()` + on save); `_events` (`node:events` emitter); `exportState()` (writable leaves + attrs); `importState(state)` (force-set, restores attrs, force-creates absent leaves with saved type, emits `load`); `saveState()` (snapshot, clear dirty, emit `save`).
- [x] **Tests:** `test/state.test.ts` — writable-only export (read-only serial omitted); attributes round-trip; import restores values + force-creates absent leaf w/ type; null-safe; dirty set-on-mutation / clear-on-save; `save`/`load` events carry `(device, state)`.

**Design note:** dirty tracking is always-on via `_onChange`; `start()` resets `_dirty=false` as the **clean baseline** (construction/identity/MAC/ACS-config + any `importState` are re-derivable, so a never-touched device won't auto-save). The lib stays **IO-free** — `_events`/`saveState` emit; the caller persists. The device exposes `_events` for the simulator (Phase 2) to forward as `device:save`/`device:load`.

### Phase 2 — Simulator: event bus + auto-save triggers + boot-load — 🟢 SHIPPED

**Objective:** the simulator forwards `device:save`/`device:load`, auto-saves on stop + after each session (when dirty), and applies state at boot. **Validation:** events observed; stop saves dirty devices; session-end save fires once. ✅ 5 new tests; full suite **152 green**; `tsc` clean.

- [x] **`src/cwmp-device.ts`** — emits `session-end` at the single session terminal (`handleMethod`, empty-body branch).
- [x] **`src/cwmp-sim.ts`** — `extends EventEmitter`; `_wireDeviceEvents()` (in `addGroup`) re-emits each device's `save`/`load` as **`device:save`/`device:load`** and runs the dirty-gated auto-save on `session-end`; `_applyLoadedState()` (boot-time `importState` from `options.loadState`, called in `_registerAndBoot` before `device.start()`); `saveAll()`; `stop()` saves dirty devices first.
- [x] **`src/types.ts`** — `CwmpSimulatorOptions.loadState?: (serial) => SavedState | undefined` (the inbound counterpart to the `device:save` event; keeps file reads in the caller).
- [x] **Tests:** `test/state.test.ts` — `saveAll` emits `device:save`×N with state; `session-end` saves only the dirty device; `stop()` saves only dirty; `device:load` forwarded; `loadState` provider applies by serial at boot.

**Design note:** **load is a pull** (`options.loadState(serial)` invoked at boot in `_registerAndBoot`, before `device.start()` sets the clean baseline) while **save is push** (events). Boot-time load satisfies Decision 6 (not at construction, so listeners attached after `new CWMPSimulator` observe `device:load`). The lib still touches no filesystem — `loadState` is injected by the caller.

### Phase 3 — Binary: convenience file store in `storage.ts` — 🟢 SHIPPED

**Objective:** out-of-the-box file persistence keyed by serial — **all filesystem I/O lives in the binary**, not the lib or the config layer. **Validation:** run → ACS sets a param → stop → file written; restart → device re-informs the restored value. ✅ 5 tests + a save→reload smoke (interval 300 round-trips); full suite **157 green**; `tsc` clean; `dist/storage.js` builds.

> **Two corrections from the first draft:** (1) state-file I/O must NOT live in `src/config/` — that would drag it back into the I/O-free library/config layer. (2) Rather than inline it in `main.ts`, it lives in a dedicated **root-level [`storage.ts`](../../../storage.ts)** (sibling to `main.ts`, *outside* `src/`) — isolated, directly testable, and clearly not part of the library. The config registry / `CwmpSimulatorOptions` stay simulator-only; storage parses `--storage-dir` itself.

- [x] **`storage.ts`** (root; the only state-I/O module) — `resolveStorageDir(argv, env)` (`--storage-dir` / `STORAGE_DIR` / default `~/.cwmp-sim/devices`, leading `~` via `os.homedir()`), `readState(dir, serial)` (`<dir>/<serial>.json` → `SavedState | undefined`), `writeState(dir, serial, state)` (`mkdir -p`, serial sanitized to stay in-dir, **atomic** temp-write + rename). The library never imports it.
- [x] **`main.ts`** (thin) — imports the three helpers; `options.loadState = (serial) => readState(dir, serial)`; `client.on('device:save', (d, state) => writeState(dir, d._serialNumber, state))`; SIGINT → `client.stop()` flushes dirty saves; `--help` gains a `--storage-dir` line; summary prints the storage dir.
- [x] **`tsconfig.json` / `tsconfig.build.json`** — add `storage.ts` to `include` (root file like `main.ts`).
- [x] **No `src/config` / `src/types` change** for storage (it's not a simulator option). _(Tests import `../storage.ts` directly, so `main.ts` needs no entry-guard.)_
- [x] **Tests:** `test/state-cli.test.ts` — round-trip in an `mkdtemp` dir; missing → undefined; flag/env/`~` resolution; atomic write leaves one `.json`; unsafe serial sanitized in-dir.
- [ ] **`PENDING.md`** — note state persistence shipped (below).

## Risks & tradeoffs

- **AddObject round-trip.** Force-`set`ting an instance leaf re-creates the node, but `funcObj` defaults and
  `…NumberOfEntries` counters won't auto-rebuild. Phase 1 restores plain leaves; if fidelity gaps show, a refinement
  is to detect instance paths in `importState` and call `addObject` first. Flag as a known limitation initially.
- **Serial collisions / changing the `{i}` pattern.** State is keyed by serial; if the user changes the serial
  pattern between runs, old state won't match (correct — it's a different device). Document.
- **Event timing.** Load/`device:load` must fire at boot, not construction (listeners attach after `new`). Covered by Decision 6.
- **Partial writes.** CLI should write atomically (temp file + rename) to avoid corrupt JSON on crash. Note in Phase 3.
- **Scope creep into fleet/04.** This plan does save/load only. The *dynamic control API* (add/remove/restart) and the
  broader `device:*` bus are **fleet/04**; here the emitter is introduced but only `save`/`load` are emitted.

## Resume state

- **Done:** **All 3 phases 🟢 shipped.** P1 lib serialize/dirty/events; P2 simulator `device:save`/`device:load` bus + dirty-gated auto-save (session-end/stop) + boot-time `loadState` pull; P3 root **`storage.ts`** file store (`--storage-dir`, default `~/.cwmp-sim/devices`, atomic write) wired by `main.ts`. Full suite **157 green**; `tsc` clean; `dist/storage.js` builds; save→reload smoke verified.
- **Next action:** none for fleet/03. Follow-ons: **fleet/04** (dynamic add/remove/restart API + the broader `device:*` bus, on the `addGroup` seam), **#16** dashboard. Possible refinement: AddObject round-trip fidelity (see Risks).
- **Open questions:** None.
- **Watch out for:** keep the lib **IO-free** — all `fs`/`os.homedir()` lives in the root binary modules `storage.ts` / `models.ts` + `main.ts`, never in `src/`. Apply state **after** identity so read-only serial/OUI stay authoritative.
- **Post-ship refinement (2026-06-16):** CLI/library options boundary tightened (see fleet/02's note). `storage.ts`'s `resolveStorageDir` no longer parses argv — `--storage-dir` is a config field (`CliOptions.storageDir`) and `resolveStorageDir(raw)` just expands `~`. main.ts: `buildOptions` (pure) → `toSimulatorOptions` (binary, reads model files) → `resolveStorageDir(cli.storageDir)` → wire `loadState`/`device:save` → `new CWMPSimulator`.

## Final verification checklist

- [ ] `npm run check` clean; `npm test` green (state + cli round-trip tests).
- [ ] `exportState` = writable leaves only (read-only serial/OUI excluded) + attrs + ParameterKey; JSON keyed by path.
- [ ] `importState` restores values via force-set; applied after model+identity; identity untouched.
- [ ] Dirty flag: set on mutation, cleared on save; auto-save only when dirty.
- [ ] `client.on('device:save'/'device:load')` fire (stop + session-end + boot); `saveAll()` works.
- [ ] Lib has **no** `fs`/`os` import; `--storage-dir` (default `~/.cwmp-sim/devices`) round-trips via the CLI; atomic write.
- [ ] Restart restores ACS-set values (manual/integration smoke).
- [ ] Status synced: this header, `00-fleet.md`, `index.md`.
