<!--
Domain: fleet
Status: 🟢 Shipped
Priority: High
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: fleet/01 (🟢 multi-device runtime), enhancements/01·P3 (🟢 templating)
Reference: ./00-fleet.md
-->

# FLEET-02 — Device templates (models)

_Status: 🟢 Shipped (Phases 1–3) · Priority: High · Created: 2026-06-16_

> **Note:** shipped as **`model`** (`--model`, `models/`, `src/model/`), not `template` — see Decision 13. Read "template" throughout this doc as "model".
>
> **Post-ship architecture refinements (2026-06-16):**
> - **CLI vs library options boundary.** `buildOptions` (config) is **pure** and returns a distinct **`CliOptions`** (model *paths*, `storageDir`; reads no files). All file I/O is in the **binary**: root **`models.ts`** holds `loadModel` (was `src/model/loader.ts`'s `fs` half) + **`resolveFleet(cli.fleet)`** (replaces `src/config/models.ts`'s `resolveModels`), which loads model files and returns **only** the resolved `CwmpFleetOptions` (model *objects*). `src/model/loader.ts` keeps only the pure parsers; `src/` + `src/config/` are filesystem-free.
> - **It's all fleet.** `CwmpSimulatorOptions` has **no top-level `device`** — a single device is a fleet of one default group (`groups: [{count:1, device:{}}]`). Lib types dropped `device`, `fleet.count`, `modelName`, `modelsDir`; base index is `fleet.index`. main.ts composes: `{ conn, acs, log, fleet: resolveFleet(cli.fleet), loadState }`.
> - **`--model` is a file path.** Full `.csv`/`.json` path (relative/absolute), not a name — groups load from any folder (`--model ./a/zte.csv --model /b/huawei.json`). `--models-dir` removed; `default`/empty = built-in tree.

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-fleet.md, and ../index.md. -->

## Goal

Let devices be **different types** — a real ZTE, Huawei, Nokia — by loading their full parameter tree
from a **template** file (CSV or JSON), instead of every device using the hardcoded `defaultTR98/181`.
Templates live in `/templates`; a device selects one by name. The fleet can mix types — e.g. **5 Huawei
+ 10 ZTE** — via **grouped flags**: each `--template <name|default>` opens a device group and the
group-scoped flags that follow (`--count`, `--interval`, identity, …) bind to it, until the next
`--template`; global flags (`--acs`, `--port`, `--log-level`) apply fleet-wide. The template is the base
tree; the simulator injects any **missing required nodes** (ManagementServer, diagnostics) from the
built-in defaults, then overlays per-device identity (`{i}` serial/OUI/MAC + ACS/CR config).

## Reconnaissance

### Files read / searched

- `src/cwmp-device.ts` — constructor builds `_rootTree` from `defaultTR98()/defaultTR181()`, then overlays: `loadJSON()` (`DEVICE_JSON`), `applyMac()`, and (post-construction) `configureManagementServer()`. **`defaultTR98/181` bake serial/OUI into `DeviceInfo` while building** — that identity injection must move to a post-build `applyIdentity()` so the same overlay works on a template base. `convertObjectToCwmp(json)` already turns a plain object into the `{_value,_type,_writable}` tree shape — the JSON template path largely exists.
- `src/cwmp-params.ts` — the tree shape templates must produce: nested containers + leaves `{_value, _type, _writable}`.
- `src/cwmp-model.ts` — `models.merge(target, source)` (deep merge, source wins; `null` deletes) — reusable for overlay / gap-fill.
- Diagnostics register keys (`diag-ping.ts` etc.) — listeners attach on `Device.IP.Diagnostics.IPPing.DiagnosticsState` (TR-181) / `InternetGatewayDevice.IPPingDiagnostics.DiagnosticsState` (TR-098), and TraceRoute / Download / Upload equivalents. **These subtrees + `${root}.ManagementServer` are the "required nodes"** the simulator's machinery depends on.
- `src/config/{fields,parser}.ts` — declarative field registry + `buildOptions`; `fleet.count`/`fleet.bootDelay` exist. New: `--template` (repeatable), `--templates-dir`, `--fleet-file`.
- `src/cwmp-sim.ts` — the fleet: builds N devices from `fleet.count` with index `base+i`. Becomes: build from a **composition** (template→count entries).
- `F:/github/genieacs-sim/src/csv-parser.js` + a real model CSV — RFC4180 parser (quoted fields, `""` escaping) + header-keyed `reduce`. Real dumps have **12 columns** (`Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp`) and rows like `DeviceID.OUI,false,…,false,…,"C0B102",xsd:string,…`. We use only 5 columns (header-keyed) → genieacs dumps load unchanged.

### Existing patterns to reuse

- `convertObjectToCwmp` (JSON → tree) and `models.merge` (deep merge / gap-fill).
- The post-build overlay pattern (`applyMac`, `configureManagementServer`) — `applyIdentity()` joins it.
- `config/fields.ts` registry for the new flags.

### Gaps

- No CSV parser (our own, per decision); no template loader/registry; no `/templates`.
- Identity (serial/OUI) is baked into `defaultTR98/181` rather than a reusable overlay.
- The fleet runs one model (`fleet.count`); no multi-template composition.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **Template is the base tree; inject only missing required nodes** (`${root}.ManagementServer` + the diagnostics subtrees) from defaults if absent; then overlay identity. | User answer (Layering). |
| 2 | **Header-keyed CSV** — parse RFC4180, read fields by header name, use only `Parameter,Object,Writable,Value,Value type`, ignore extras. genieacs's 12-col dumps load unchanged. | User answer (CSV columns). |
| 3 | Our CSV schema: `Parameter,Object,Writable,Value,Value type` (`Object`=true ⇒ container, false ⇒ leaf). Our own parser (no dependency). | User notes. |
| 4 | **Fleet composition via grouped flags** (revised — see Decision 9). `--fleet-file` is **dropped**; env-only was rejected (no room for per-group overrides). A file-based config (`config.json`) is a separate future enhancement, not this plan. | User decision 2026-06-16. |
| 9 | **Grouped-flag CLI.** `--template <name\|default>` opens a device **group**; group-scoped flags (count, interval, serial/oui/mac, no-traceroute…) bind to the current group until the next `--template`; global-scoped flags (acs/port/log) apply fleet-wide regardless of position. Zero `--template` = one implicit group (today's behavior, backward compatible). A group = `{ template?, count, deviceOverrides }`; the global index increments across all groups' devices so identities stay distinct. | User decision (locked: "Grouped flags"). |
| 10 | **Scope-tagged registry.** Each `configFields` entry gains `scope: "global" \| "group"` (default `global`). The parser splits global vs group flags by tag, not position — so a new per-group knob is added once and works both fleet-wide and per-group, and shows in `--help`. No second mini-DSL. | User goal ("extend more configs per template"); reuses the existing registry. |
| 11 | **Unify model loading under `--template`; drop `--csv`/`--json`.** `--template <name\|path>` is the *only* way to supply a device model (name → templates dir; `.csv`/`.json` path → loaded directly; basename → group label/cache key). This deletes `loadJSON()` + the `fs` import + `defaultCSV`/`exportCSV` from `cwmp-device.ts` — **the lib becomes fully IO-free** (templates always arrive pre-parsed via the config layer). `--json` already replaced the root subtree, so `--template` strictly subsumes it (adds required-node injection + root inference). | User decision 2026-06-16 ("we drop --csv/--json, use --template"). |
| 12 | **Build the fleet through a reusable `CWMPSimulator.addGroup(group)` seam.** The constructor calls `addGroup` once per configured group; static composition and (future) runtime add/remove/restart share one code path. Lays the seam for **fleet/04** (dynamic control API + `device:*` event bus) and **fleet/03** (state save/load events) at no extra cost now. main.ts stays thin — all composition/lifecycle lives on the simulator class, not the CLI entry. | User vision (on-demand add/remove/restart, `client.on('device:*')`); in-process design exists for this. |
| 13 | **Naming: the feature is `model`, not `template`** — `--model`, `models/`, `src/model/`, `modelName`/`modelsDir`, `LoadedModel`, `resolveModels`, `FleetGroup.model`, env `DEVICE_MODEL`/`MODELS_DIR`. Matches GenieACS (`models/*.csv`) + TR-069 "data model". The built-in param library `cwmp-model.ts` → **`cwmp-defaults.ts`** to free the word. The `{i}` identity templating (`config/template.ts`/`applyTemplate`) is a *separate* "template" and unchanged. | User decision 2026-06-16 ("call it --model", genieacs parity). |
| 5 | Templates resolve by name from a `--templates-dir` (default `./templates`): `name` → `templates/name.{csv,json}`. | `(defaulted: simple filename lookup)`. |
| 6 | Identity injection moves from `defaultTR98/181` into a post-build `applyIdentity()` (sets `DeviceInfo.SerialNumber`/`ManufacturerOUI` from the resolved `{i}` values), unifying default + template paths. | `(defaulted: required for template base; code evidence)`. |
| 7 | Root (`Device` vs `InternetGatewayDevice`) is taken from the template's top-level key; the matching default sources required nodes. Single-device may still use `--template`. | `(defaulted: infer from template)`. |
| 8 | Ship 1–2 small example templates in `templates/` (closes part of PENDING #11). State persistence is the **next** plan (fleet/03). | `(defaulted: examples aid adoption; state is separate)`. |

## Proposed architecture

```
templates/<name>.csv|json   ──load──▶  CwmpParams tree (base)
                                          │ ensureRequiredNodes(root)  ← fills ManagementServer + diag subtrees from default if absent
                                          │ applyIdentity()            ← DeviceInfo.Serial/OUI from {i}; applyMac(); configureManagementServer()
                                          ▼
                                       Runtime CWMPDevice

CLI grouped flags ─parse─▶ base (global) + ordered groups
   --template default --count 5            group A: built-in tree ×5
   --template huawei  --count 5            group B: huawei  tree ×5
   --template zte --count 10 --interval 5000 --no-traceroute   group C: zte tree ×10 (+overrides)

CWMPSimulator(fleet.groups): for each group, load its template once, then
   for i in 0..count: new CWMPDevice({ ...base, ...group.deviceOverrides, template, index })
   global index increments across ALL groups (A 0..4, B 5..9, C 10..19) → distinct identities
```

- **New (Phase 1, 🟢):** `src/template/csv.ts`, `src/template/json.ts`, `src/template/loader.ts`, `templates/`.
- **`src/cwmp-device.ts` (Phase 2, 🟢):** `options.template` ({root,tree}) → base; `ensureRequiredNodes()`; `applyIdentity()`.
- **`src/types.ts`:** `CwmpDeviceOptions.template?/.templateName?` (🟢); `CwmpFleetOptions` gains `groups?: FleetGroup[]` (Phase 3) alongside `count`/`templatesDir`. `FleetGroup = { templateName?: string; count: number; device?: Partial<CwmpDeviceOptions> }`.
- **`src/config/` (Phase 3):** scope-tag the registry (Decision 10); a grouped-flag parser producing `fleet.groups`; `resolveTemplates` loads every group's template; `--templates-dir` (🟢). `--fleet-file` dropped.
- **Source-of-truth:** tree shape = `cwmp-params.ts`; options = `types.ts`.

### CSV → tree mapping

| Row | Becomes |
|---|---|
| `Object=true`  | a container node (intermediate; no `_value`) |
| `Object=false` | a leaf `{ _value: Value, _type: "Value type", _writable: Writable==="true" }` |

`Parameter` is the full path; build nested containers by splitting on `.`. (Skip/relocate genieacs's `DeviceID.*` virtual rows — note in loader.)

## Phases

### Phase 1 — Template loader (CSV + JSON) — 🟢 SHIPPED

**Objective:** `loadTemplate(name)` returns a tree from a CSV or JSON file. **Validation:** unit tests over both formats incl. a genieacs-style 12-col CSV. ✅ 12 new tests; full suite 124 green; `tsc --noEmit` clean.

- [x] **CREATE `src/template/csv.ts`** — RFC4180 `parseCsv(text)` (quotes/`""`/CRLF/BOM) + header-keyed `toRows` → rows; `rowsToTree(rows)` → nested `{_value,_type,_writable}` tree, root inferred, virtual `DeviceID.*`/`Tags.*` rows skipped.
- [x] **CREATE `src/template/json.ts`** — extracted `convertObjectToCwmp`/`inferXsdType` here (moved out of `cwmp-device.ts`, which now imports them) + `jsonToTree` (plain-value JSON → `{root,tree}`).
- [x] **CREATE `src/template/loader.ts`** — `loadTemplate(nameOrPath, dir=./templates)`: resolve explicit `.csv/.json` path or `dir/name.{csv,json}`; CSV via `csv.ts`, JSON via `json.ts`. Returns `{ root, tree }`. Throws a helpful error if not found.
- [x] **CREATE `templates/`** — `generic-tr098.csv`, `generic-tr181.json`, `README.md` (format docs). The CSV intentionally omits ManagementServer/diag → Phase 2's `ensureRequiredNodes` injects them.
- [x] **Tests:** `test/template-csv.test.ts` — quoting/escaping/CRLF/BOM; `Object` true/false → container/leaf; header-keyed ignores extra columns (genieacs 12-col sample) + skips virtual rows; default xsd:string; JSON load; shipped-file load by name; not-found error.

**Note:** `convertObjectToCwmp` was private to `cwmp-device.ts` (the plan assumed it reusable) — extracted to `src/template/json.ts` so the loader reuses it with no device dependency. JSON templates are **plain values only** (no `_value/_type/_writable`); CSV is the rich format. Behavior of the device's `DEVICE_JSON` overlay is unchanged.

### Phase 2 — Device consumes a template — 🟢 SHIPPED

**Objective:** a device builds from a template + required-node injection + identity overlay.
**Validation:** a device built from a partial template still has ManagementServer + diagnostics and the right identity. ✅ 5 new device tests + a CLI end-to-end smoke; full suite 129 green; `tsc --noEmit` clean.

- [x] **UPDATE `src/cwmp-device.ts`** — accept `options.template` ({root,tree}); when present, deep-clone it as `_rootTree` and take `_rootName` from `template.root` (else `defaultTR98/181`); add `ensureRequiredNodes()` (fill `${root}.ManagementServer` + diag subtrees from the matching default when absent); add `applyIdentity()`, called post-build for both paths.
- [x] **UPDATE `src/types.ts`** — `CwmpDeviceOptions.template?` + `.templateName?`; `CwmpFleetOptions.templatesDir?`.
- [x] **UPDATE `src/config/`** — `--template` (`device.templateName`, env `DEVICE_TEMPLATE`) + `--templates-dir` (`fleet.templatesDir`, env `TEMPLATES_DIR`); new `config/templates.ts` → `resolveTemplates(options)` (async load name→tree onto `device.template`); `main.ts` awaits it (ESM top-level await) and prints the template line.
- [x] **Tests:** `test/cwmp-device.test.ts` — template becomes base + root inferred; required nodes injected from defaults; identity overlays the template's placeholder serial/OUI; templated device still takes ACS/CR config; a shared template object is not mutated across devices (deep-clone).

**Design refinement (vs the plan's "identity overlay"):** identity splits into **per-unit** (SerialNumber + ManufacturerOUI — the `{i}`-stamped fields; `applyIdentity()` force-overlays these over any template placeholder) and **model** (Manufacturer + ProductClass — left to the template / the built-in defaults from options, *not* overlaid). The plan's own identity list was "serial/OUI/MAC", so this matches intent; it just makes explicit that Manufacturer/ProductClass belong to the model, so loading a ZTE template keeps its make/class while each unit still gets a unique serial. MAC stays handled by `applyMac()`. Template loading is async, so it runs in the config layer (`resolveTemplates`) before the sync `CWMPSimulator`/`CWMPDevice` constructors — the device never does file I/O.

### Phase 3 — Fleet composition (grouped flags) — 🟢 SHIPPED

> **Late rename (Decision 13):** the device-type-from-file concept shipped as **`model`**, not `template` —
> `--model`, `models/`, `src/model/`, `modelName`/`modelsDir`, `LoadedModel`, `resolveModels`, `FleetGroup.model`.
> The built-in param library `src/cwmp-model.ts` was renamed `src/cwmp-defaults.ts` to free the word.
> The `{i}` identity templating (`src/config/template.ts` / `applyTemplate`) is a *different* "template" and was left untouched.
> Read every "template" below as "model".

**Objective:** mixed-type fleets via **grouped flags** — each `--model <name|default>` opens a device group; group-scoped flags bind to it; global flags apply fleet-wide. **Validation:**
`--model huawei --count 5 --model zte --count 10` → 15 devices (5 huawei + 10 zte), distinct identities, global index across groups; zero `--model` → unchanged single-group behavior. ✅ 8 new parser/composition tests; full suite **137 green**; `tsc` clean; CLI `--model generic-tr098 --count 2 --model default --count 1` smoke verified.

**Design (locked — Decisions 9 & 10):**
- A **group** = `{ templateName?: string; count: number; device?: Partial<CwmpDeviceOptions> }`. `templateName` absent or `default` → built-in tree.
- **Scope tag** on each `configFields` entry: `scope: "global" | "group"` (default `global`). Group-scoped: `device.*` (serialNumber, oui, mac, manufacturer, productClass, rootName, csv/json paths), `device.templateName`, `fleet.count`, plus future per-group runtime knobs (interval, no-traceroute…). Global: `acs.*`, `conn.*`, `log.*`, `fleet.bootDelay`, `fleet.templatesDir`.
- **Parser model:** one pass over argv. Global flags → a base map (any position). `--template` opens a new group; subsequent **group-scoped** flags fill the current group; if a group-scoped flag appears before any `--template`, it seeds the base/implicit group. Result: `fleet.groups: FleetGroup[]` (≥1). Zero `--template` and no group flags → `groups` stays empty → simulator falls back to the single `{ count: fleet.count }` path.

**Tasks (all shipped; names per the model rename):**
- [x] **`src/config/fields.ts`** — `scope` added to `ConfigField`; group fields tagged (`device.modelName`/serial/oui/mac/manufacturer/productClass/rootName + `fleet.count`); `--csv`/`--json` removed; `--model`/`--models-dir` added.
- [x] **`src/config/parser.ts`** — `buildOptions` emits `fleet.groups` from the grouped walk (`readGrouped` → base segment + ordered `--model` groups); base/`fleet.count` kept for the single-group fallback.
- [x] **`src/config/models.ts`** (was `templates.ts`) — `resolveModels` loads each group's `modelName` → `group.model` (cached by name; `default`/empty → built-in); single-`device.modelName` back-compat path kept.
- [x] **`src/types.ts`** — `LoadedModel` (canonical here); `FleetGroup = { count; device: CwmpDeviceOptions; model?: LoadedModel }`; `CwmpFleetOptions.groups?`/`modelsDir?`; `CwmpDeviceOptions.modelName?`/`model?`; `csvPath`/`jsonPath` removed.
- [x] **`src/cwmp-device.ts`** — `loadJSON`, `node:fs/promises`, `defaultCSV`, `exportCSV`, `_csvPath`/`_jsonPath` deleted → **lib is IO-free**; `options.model` is the base. (`models` import now from `./cwmp-defaults.ts`.)
- [x] **`src/cwmp-sim.ts`** — `_nextIndex` + `addGroup(group)` seam + `_registerAndBoot`; constructor builds per `fleet.groups` (else single-group fallback); `start()` boots all; runtime-add path wired (fleet/04 reuse).
- [x] **`main.ts`** — thin; per-group summary; SIGINT → `client.stop()`.
- [x] **`src/config/help.ts`** — grouped-flag usage + `[group]` scope tags.
- [x] **Tests:** `test/fleet.test.ts` (grouped split, global index across groups, base-seeding, global-applies-to-all, zero-group fallback, `addGroup` reuse) + `test/config.test.ts` (scope split, base seeding, ≥1 group).

**Follow-on (NOT this plan):** **fleet/03** = per-device state persistence + `client.on('device:save'|'device:load')`; **fleet/04** = dynamic fleet-control API (`addGroup`/`removeGroup`/`restart` public) + `device:*` event bus; **#16** dashboard consumes fleet/04. The `addGroup` seam built here is what makes those cheap.

## Risks & tradeoffs

- **Required-node list drift** — if a new diagnostic/feature adds a tree dependency, add it to `ensureRequiredNodes`. Keep the list next to the diag register keys; a test asserts a minimal template still boots.
- **Big templates** — real dumps are 100KB–1MB; parsed into memory per template (loaded once per type, shared across that type's N devices — not per device). Fine for hundreds; note the per-type memory.
- **genieacs `DeviceID.*` rows** — virtual; the loader skips or maps them. Document.
- **Template's own serial/MgmtServer** — overridden by `applyIdentity()`/`configureManagementServer()`; the dump's stale values never leak. Verified by a test.

## Resume state

- **Done:** **All 3 phases 🟢 shipped + the `template`→`model` rename (Decision 13).** Phase 1 (`src/model/{csv,json,loader}.ts`, `models/*`), Phase 2 (model-as-base + `ensureRequiredNodes` + `applyIdentity`), Phase 3 (grouped flags → `fleet.groups`, `addGroup` seam, IO-free device, `cwmp-model.ts`→`cwmp-defaults.ts`). Full suite **137 green**; `tsc` clean; mixed-fleet `--model` CLI smoke verified.
- **Next action:** none for fleet/02. Follow-ons: **fleet/03** (per-device state + `device:save`/`load` events), **fleet/04** (dynamic add/remove/restart API + `device:*` bus, built on the `addGroup` seam), **#16** dashboard. Also: `PENDING.md` #4 / #11 to check.
- **Open questions:** None.
- **Watch out for:** each distinct model loads **once** (cached in `resolveModels`), shared across its group's N devices; `applyIdentity()` runs for both default and model bases (per-unit serial/OUI only). The plan prose still says "template" in places — read as "model" (Decision 13).

## Final verification checklist

- [ ] `npm run check` clean; `npm test` green (csv/loader/device/fleet tests).
- [ ] CSV loader: our 5-col format **and** a genieacs 12-col dump both parse (header-keyed); `Object` true/false → container/leaf.
- [ ] A partial template (no ManagementServer/diag) still boots: required nodes injected; diagnostics work.
- [ ] Identity overlays the template (`DeviceInfo.SerialNumber` = `{i}`, not the dump's serial); MgmtServer = configured ACS.
- [ ] Grouped flags: `--template huawei --count 5 --template zte --count 10 --interval 5000` → 15 devices (5+10), distinct identities, zte-group override applied; zero `--template` unchanged.
- [ ] 1–2 example templates ship under `templates/`; PENDING #4 + #11(partial) checked.
- [ ] Status synced: this header, `00-fleet.md`, `index.md`.
