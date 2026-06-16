<!--
Domain: dashboard
Status: 🟢 Shipped
Priority: Medium
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: dashboard/02 (🟢 metrics), fleet/02–04 (🟢)
Reference: ./00-dashboard.md
-->

# DASH-03 — Control config (`--interval` / `--off`) + telemetry v2

_Status: 🟢 Shipped · Priority: Medium · Created: 2026-06-16_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-dashboard.md, and ../index.md. -->

## Goal

Two things: (1) **CLI control** to tune/disable device behavior — `--interval N` (periodic inform, in
**seconds**) and a normalized **`--off <feature>`** (repeatable: `--off inform`, `--off cr`); and (2)
**more telemetry** — counters for connection-requests received, CR auth failures, device→ACS auth
failures, and download/upload (transfer) failures — per-device + fleet-wide, surfaced in the dashboard.
Also fixes the global "rpc sent · current" (was `—`; now computed).

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **`--interval N`** sets the periodic-inform interval in **seconds → ×1000 ms** (`setTimeout` uses ms). Group-scoped (per `--model` group). | User: "--interval 300 in seconds → ms". |
| 2 | **`--off <feature>` repeatable, case-insensitive, group-scoped.** Features: `inform` (no *periodic* informs — boot inform still happens), `cr` (don't register/advertise the Connection-Request route). Normalizes all toggles (future `--off save`, …). | User answer (Disable syntax). |
| 3 | The grouped parser **accumulates** multiple `--off` per group (today flags are last-wins) — collect comma-joined per segment → a Set; map to `device.noInform`/`device.noCr`. | Needed for `--off inform --off cr`. |
| 4 | **Four new counters** (per-device + global): **CR received**, **CR auth failures**, **device→ACS auth failures**, **transfer (dl/ul) failures**. CR counters originate in `CWMPConn` (server total) + attributed per-device (routed hash); ACS-auth in `CwmpHttp`/device; transfer in `finishTask` (task result). Folded into `_stats` + emitted on the bus where a live log line helps. | User answer (New counters). |
| 5 | Knobs (`interval`/`noInform`/`noCr`) are **group-scoped device options**; CR/transfer/auth telemetry uses the same lib-tracked `_stats` + simulator-global model as dashboard/02. | Consistency with the all-fleet + event-time-stats model. |

## Phases

### Phase 1 — Control config (`--interval`, `--off`)

- **`src/config/`** — `--interval` (group, seconds→ms via a custom parse) → `device.interval`. `--off` (group, repeatable): parser accumulates per segment → a set → `device.noInform`/`device.noCr`. Help line for `--off`.
- **`src/types.ts`** — `CwmpDeviceOptions`: `interval?` (ms), `noInform?`, `noCr?`. (CLI side: `CliDeviceOptions` carries the raw inputs.)
- **`src/cwmp-device.ts`** — `_periodicInformInterval = options.interval ?? default`; `_noInform` → `setPeriodicInform` no-ops when set (boot inform unaffected).
- **`src/cwmp-sim.ts`** — `_registerAndBoot` skips CR `register` + `setConnectionRequestURL` when `device._noCr`.
- **Tests:** `config.test` (`--interval 300` → 300000 on the group device; `--off inform --off cr` → `noInform`/`noCr`); `cwmp-device`/`fleet` (no-inform device doesn't schedule periodic; no-cr device isn't registered).

### Phase 2 — Telemetry v2 (the four counters)

- **`src/types.ts`** — extend `DeviceStats`: `crReceived`, `crAuthFail`, `acsAuthFail`, `transferFail`.
- **`src/cwmp-conn.ts`** — count CR requests received + auth failures (server total); call back per-device (route gains an `onAuthFail()` / the device counts on `onConnectionRequest`). Device increments `crReceived`/`crAuthFail`.
- **`src/cwmp-http.ts` / device** — detect a 401 from the ACS → `acsAuthFail++` (+ a `device:rpc`-style fail line).
- **`src/cwmp-device.ts`** — `finishTask` records task **result** (ok/fail) in the history; transfer faults → `transferFail++`.
- **`src/cwmp-sim.ts`** — accumulate the new counters into the global `_stats` at event time.
- **Tests:** `metrics.test` — each new counter increments device + global; CR auth-fail attributed per-device; transfer fail recorded.

### Phase 3 — Dashboard surfacing

- **`dashboard.ts`** — include the new counters in `/api/devices/:serial` stats, the `/api/fleet` summary, and `global`.
- **`dashboard.html`** — show CR received / CR auth-fail / ACS auth-fail / transfer-fail in the device summary panel + global box; feed lines for CR + auth failures; (already) fixed `rpc sent · current`.
- **`PENDING.md`** — note.

## Risks & tradeoffs

- **`--off` parser accumulation** — the only structural parser change; keep it minimal (comma-join per segment, split→set in `buildOptions`). Base-segment `--off` is *not* inherited by explicit `--model` groups (per-group explicit); document.
- **`--off inform` semantics** — disables **periodic** informs only; the boot/CR informs still fire (matches `PeriodicInformEnable=false`). Document so it's not read as "fully silent".
- **ACS-401 detection** — depends on `CwmpHttp` surfacing the status; if it only returns a body, thread the status through (small change).
- **CR auth-fail attribution** — the routed hash maps to a device; an auth-fail for an *unknown* hash is a server-total only (no device).

## Resume state

- **Done so far:** All 3 phases shipped. P1 — `--interval` (sec→ms), `--off inform/cr` (repeatable, case-insensitive, group-scoped) → device `_periodicInformInterval`/`_noPeriodicInform`/`_noConnectRequest`; CR registration skipped when `noCr`. P2 — `DeviceStats` gained `crReceived`/`crAuthFail`/`acsAuthFail`/`transferFail`; each is its **own** device event (`crReceived`/`crAuthFail`/`acsAuthFail`/`transferFail` — no generic `counter`/discriminator), accumulated fleet-wide at event time + re-emitted as `device:*`; `handle*` methods (CR via `CWMPConn` route `onReceived`/`onAuthFail`; ACS 401 via `CwmpHttp`; transfer fault via `finishTask`, which now records task `ok`). P3 — counters surfaced in `/api/fleet` (per-device + global), `/api/devices/:serial`, the global box, the device panel, and the live feed; global `rpc sent · current` bug fixed.
- **Tests:** 217 pass; `tsc` clean; build ok; deps `{}`.
- **Next action:** None — done.
- **Open questions:** None.
- **Watch out for:** event names are camelCase (`crReceived`, …) and re-emitted as `device:crReceived` — keep device/sim/dashboard/tests in sync; `--off` is group-scoped + repeatable (set, not last-wins); `--interval` is seconds at the CLI, ms in the lib.

## Final verification checklist

- [x] `npm run check` clean; `npm test` green (217); zero new deps (`{}`).
- [x] `--interval 300` → device `_periodicInformInterval` 300000 ms; `--off inform`→no periodic inform; `--off cr`→not CR-registered; case-insensitive; repeatable in a group.
- [x] Counters: CR received, CR auth-fail, ACS auth-fail, transfer-fail increment per-device + global (distinct event each).
- [x] Dashboard shows the new counters + the fixed `rpc sent · current`.
- [x] Status synced: this header, `00-dashboard.md`, `index.md`; PENDING noted.
