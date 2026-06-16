<!--
Domain: enhancements
Status: 🟢 Shipped   (P2 + P3 shipped)
Priority: Medium
Created: 2026-06-15
Revalidated: 2026-06-15
Dependencies: roadmap/plans/architecture/01-entry-lib-refactor.md (🟢 Shipped)
Reference: ./00-enhancements.md
-->

# ENHANCEMENTS-01 — Pre-fleet enhancements (parent)

_Status: 🟢 Shipped · Priority: Medium · Created: 2026-06-15_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-enhancements.md, and ../index.md. -->

## Goal

Small, independently-shippable improvements that harden `cwmp-sim` before the multi-device
work, each plugging into the existing declarative config registry:

1. **Cross-platform diagnostics** — make ping + traceroute work on Linux/macOS, not just Windows
   (PENDING order #3 / Idea #20; also a latent portability bug).
2. **Serial/MAC templating** — derive per-device identities (serial, OUI, MAC) from a `{i}` index
   token; adds `device.index` + `device.mac` (PENDING order #4 / Idea #2; groundwork for the fleet).

> The original P1 (SOAP wire-log, PENDING order #2 / Idea #15) was promoted into a proper logging
> subsystem — see [02-logging-subsystem.md](./02-logging-subsystem.md). The wire-log is now a
> `trace`-level use of that logger.

This plan is split into children (one per feature); each ships and validates on its own.

## Reconnaissance

### Files read

- `src/config/fields.ts` — declarative `configFields` registry: each field has `path`/`env`/`flag`/`label`/`default`/`parse`. This is where new options (`log.wire`, `device.index`, `device.mac`) are added.
- `src/config/parser.ts` — `buildOptions(env, argv)`: walks `configFields`, applies env then flag (flag wins), `setPath`s into a nested object. Templating post-process hooks here.
- `src/config/help.ts` — auto-generates `--help` from `configFields` (so new fields self-document).
- `src/config/index.ts` — re-exports `buildOptions`, `printHelp`.
- `src/types.ts` — `CwmpSimulatorOptions = { device, conn, acs }`; `CwmpDeviceOptions` has no `mac`/`index`; no `log` section.
- `src/cwmp-sim.ts` — `sendRequest(xml)` is the single chokepoint for all ACS traffic (outgoing `xml` argument, returns incoming `body`). Wire-log hooks here. Constructor takes `CwmpSimulatorOptions`.
- `src/diag-ping.ts` — `run()` builds a **Windows** `ping -n <c> -w <ms> -l <size> <host>` and parses Windows output (`Packets: Sent = .. Received = .. Lost = ..`, `Minimum = ..ms, Maximum = ..ms, Average = ..ms`).
- `src/diag-traceroute.ts` — `run()` builds **Windows** `tracert -h <max> -w <ms> -d <host>` and parses Windows hop lines. **Bug:** line 87 sets `` `${path}DiagnosticsState` `` (missing dot) — fix while here.
- `src/cwmp-model.ts` — `wanIPConnectionDeviceParams.MACAddress = '00:11:22:33:44:55'` (`_writable:false`); `wlanConfigurationParams.BSSID`. MAC is a fixture value, not driven by an option.
- `src/cwmp-device.ts` — `defaultTR98()`/`defaultTR181()` build the tree and inject `serialNumber`/`oui` into `DeviceInfo` from options; **no** MAC injection today. `set(path, value, force)` force-creates missing nodes, so MAC injection must check existence first.

### Searches performed

- `rg "process.platform|os.platform|ping -|tracert|traceroute" src` → only `diag-ping.ts` and `diag-traceroute.ts` shell out; both are Windows-only. Download/Upload/Wi-Fi diagnostics use HTTP/JS, not OS commands (unaffected).
- `ls src/config` → `fields.ts`, `parser.ts`, `help.ts`, `index.ts` (the post-lib-refactor config folder; the old plan's single `config.ts` was superseded).

### Runtime path

```
env+argv → buildOptions (config/parser.ts) → CwmpSimulatorOptions → CWMPSimulator
   → sendRequest(xml)  [WIRE-LOG hook]                                  → ACS
   → device DiagnosticsState=Requested → DiagPing/DiagTraceroute.run() [CROSS-PLATFORM exec]
templating: buildOptions post-process → device.{serialNumber,oui,mac} resolved with device.index
MAC inject: CWMPDevice constructor → set MACAddress param (force, if it exists)
```

### Existing patterns to reuse

- `src/config/fields.ts` field objects + `asBool`/`asInt`/`asString` parsers — add fields the same way; `--help` updates for free.
- `src/diag-ping.ts` / `diag-traceroute.ts` `exec(cmd, (err, stdout) => parse…)` shape — keep it, but move command-building + parsing into a testable helper.
- `test/*.test.ts` `node:test` + `node:assert/strict` suites — add parser/templating/config unit tests in the same style.

### Gaps

- No `log` section in options; wire-log needs one (`log.wire`).
- `diag-ping`/`diag-traceroute` are Windows-only and have inline, untestable parsing.
- MAC is a hardcoded fixture; no `device.mac`/`device.index` options; no templating mechanism.
- TR-181 minimal tree has no `MACAddress` leaf, so MAC injection is a no-op there until the model grows (ties to PENDING Idea #12). Documented in P3.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | Wire-log prints **both directions, raw** SOAP envelopes (→/← markers) to the console, at `CWMPSimulator.sendRequest`. | User answer (Wire-log). |
| 2 | Make **ping + traceroute** cross-platform for **win32 + posix (linux/darwin)**; extract command-building + parsing into testable functions. | User answer (Diag scope). |
| 3 | Templating syntax = **`{i}` token with zero-pad `{i:04}` and offset `{i+100}`**, resolved against a new `device.index` (default `0`). | User answer (Template syntax). |
| 4 | Add **`device.mac`** (`DEVICE_MAC`/`--mac`, templatable) and inject it into the model's `MACAddress` (where the leaf exists). | User answer (MAC option). |
| 5 | Templatable identity fields = `device.serialNumber`, `device.oui`, `device.mac` only. | `(defaulted: identity fields; others untouched)`. |
| 6 | Wire-log destination = `console.log` (consistent with the rest of the codebase). | `(defaulted: trivially reversible)`. |
| 7 | posix branch covers linux **and** darwin with one `ping`/`traceroute` codepath; unknown `process.platform` → posix. | `(defaulted: code evidence — both use BSD/GNU-style tools)`. |
| 8 | MAC injection checks `findNode(path)` exists before force-setting (avoid creating phantom nodes since `set(…, force)` force-creates). | `(defaulted: code evidence — cwmp-device.set behavior)`. |

## Proposed architecture

- **Config layer** (`src/config/`): three new fields in `fields.ts` (`log.wire`, `device.index`, `device.mac`); a new `src/config/template.ts` (`applyTemplate(value, index)`); a post-process pass in `parser.ts` that resolves templates on the three identity fields using `device.index`.
- **Types** (`src/types.ts`): add `CwmpLogOptions { wire?: boolean }` + `log?` on `CwmpSimulatorOptions`; add `mac?`/`index?` to `CwmpDeviceOptions`.
- **Engine** (`src/cwmp-sim.ts`): read `options.log?.wire` → `_wireLog`; log in `sendRequest`.
- **Diagnostics** (`src/diag-platform.ts` NEW): `pingCommand`/`parsePingOutput`/`tracerouteCommand`/`parseTracerouteHops`, each taking `platform`. `diag-ping.ts`/`diag-traceroute.ts` call these instead of inline strings/regex.
- **Device** (`src/cwmp-device.ts`): inject `options.mac` into the `MACAddress` leaf for the active root.
- **Source-of-truth files:** options contract = `src/types.ts`; config registry = `src/config/fields.ts`.

## Phases

> This plan is split. Children (each self-contained, independently shippable):

| Phase | Child | Status | Ships |
|-------|-------|--------|-------|
| P2 | [Cross-platform diagnostics](./01-pre-fleet-enhancements-p2-cross-platform-diagnostics.md) | 🟢 Shipped | ping+traceroute on linux/mac/win + parser tests |
| P3 | [Serial/MAC templating](./01-pre-fleet-enhancements-p3-serial-mac-templating.md) | 🟢 Shipped | `{i}` templating + `device.index`/`device.mac` |

_(P1 retired — promoted to [02-logging-subsystem.md](./02-logging-subsystem.md). Child labels keep their
original P2/P3 numbers to avoid breaking links.)_

**Dependencies:** none hard. P3 edits `src/types.ts` + `src/config/fields.ts`, as does plan 02 — do them
in sequence to avoid conflicts. P2 is fully isolated to the diagnostics modules.

## Risks & tradeoffs

- **posix ping/traceroute flag differences** (linux vs macOS timeout flags; `rtt` vs `round-trip` summary labels) — handled by tolerant parsers + a conservative flag subset (detailed in P2). Risk: a distro/locale whose output differs; mitigated by unit-testing against captured fixtures and failing soft (zero counts) rather than crashing.
- **MAC on TR-181** — no `MACAddress` leaf in the minimal tree, so `device.mac` is a no-op for `Device` root until the model expands. Documented, not blocking.
- **Config field overlap** between P1/P3 — coordinate edit order.

## Resume state

- **Done so far:** Parent plan written; 8 decisions locked. No code yet.
- **Next action:** Pick a child and start — recommended order P2 → P1 → P3 (P2 is isolated and fixes a real bug; P3 is the largest). Set the child + this parent + `index.md` to 🟡 when starting.
- **Open questions:** None.
- **Watch out for:** `src/config/` is a folder now (`fields.ts`/`parser.ts`/`help.ts`/`index.ts`), not the single `config.ts` from the architecture-01 plan. `set(path, value, true)` force-creates nodes.

## Final verification checklist

- [ ] All three children shipped (boxes checked, 🟢) and their validations pass.
- [ ] Type-check clean (`npm run check`).
- [ ] Relevant tests pass (`npm test`) — new parser/templating/config tests included.
- [ ] No contract drift — new options live in `src/types.ts`; fields in `src/config/fields.ts`.
- [ ] Status circle synced in three places: this header, `00-enhancements.md`, and `index.md`.
