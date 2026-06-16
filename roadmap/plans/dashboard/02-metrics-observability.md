<!--
Domain: dashboard
Status: 🟢 Shipped
Priority: Medium
Created: 2026-06-16
Revalidated: 2026-06-16
Dependencies: dashboard/01 (🟢 dashboard + control), fleet/04 (🟢 device:* bus)
Reference: ./00-dashboard.md
-->

# DASH-02 — Per-device & global metrics + richer dashboard

_Status: 🟢 Shipped (Phases 1–3) · Priority: Medium · Created: 2026-06-16_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-dashboard.md, and ../index.md. -->

## Goal

Make the dashboard *observable*: per-device and global **counters** (per-RPC received, write failures,
informs), **last received/sent RPC**, **pending + recent tasks**, and **last-inform "age"** in the
sidebar — plus a **device summary panel**, **param search** (by key or value), and a **searchable,
clearable, counted event log** that shows RPC-level detail (`Received: SetParameterValues`,
`Failed to update …`). The device is the source of truth for its own stats (lib-tracked, in-memory),
exposed via the API; the dashboard pulls on select + updates live from the `device:*` feed.

## Reconnaissance

### Files read / searched

- `src/cwmp-device.ts` — `handleMethod(body)` resolves `methodName` and logs `Received: <methodName>` → the **receive hook** (count + `lastRecv` + emit `device:rpc`). `startSession(event)` builds/sends the Inform → the **inform hook** (count + `lastInform` ts + a "sent" counter). `sendRequest(xml)` is the outbound write → the **sent hook**. `finishTask(task)` (one per completion) → **task-history** ring buffer; `_pendingTask.length` is the pending count. Has the `_events` emitter (forwarded as `device:*`) + `_serialNumber`/`_rootName`.
- `src/cwmp-methods.ts` — `SetParameterValues` calls `device.set(...)`; on a write failure it warns `Failed to update <path>` and faults 9008 → the **failure hook** (count + `lastFault` + an `ok:false` `device:rpc`).
- `src/cwmp-sim.ts` — `_wireDeviceEvents` forwards `device:*`; add `device:rpc`. `_devices`/`_groups` back the snapshots.
- `dashboard.ts` — `snapshot()` (extend per-device summary), `GET /api/devices/:serial` (add `stats`), `wireFeed` (forward `device:rpc`). `dashboard.html` (codegen) — the UI lives here now (easy to extend).
- No metrics exist today; the bus carries lifecycle but not RPC-level events.

### Existing patterns to reuse

- The `device:*` bus + `_wireDeviceEvents` forwarding (add one event type).
- `getStats()` mirrors `exportState()` (a serializable device snapshot).
- The codegen UI (`dashboard.html` → `dashboard.generated.ts`) — edit real HTML for all UI work.

### Gaps

- No `_stats` on the device; no `device:rpc` event; no task history; no `lastInform`.
- API exposes no stats; the sidebar/feed have no metrics, search, or clear.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **Lib-tracked stats** — the device keeps an in-memory `_stats` (per-RPC received/sent counts, write failures, `lastRecv`/`lastSent`, `informs`, `lastInform` ts, a task-history ring buffer) and a `getStats()` snapshot. Accurate totals that survive a dashboard reload + include pre-connect history. Still pure/in-memory (no I/O). | User answer (Stats source). |
| 2 | **Pull-on-select + live feed** — `GET /api/devices/:serial` returns `stats`; `GET /api/fleet` returns a per-device summary (serial, root, groupId, `lastInform`, `informs`, recv total, failures) for the sidebar **+ the server-computed `global`** (Decision 7); the WS feed (now incl. **`device:rpc`**) updates counts/last-RPC/relative-time live (no polling). | User answer (Delivery). |
| 3 | **New `device:rpc` event** `{ serial, method, dir: "recv"\|"sent", ok }` on the bus — drives the RPC-level log lines (`Received: X`, failures) *and* live counter bumps. | Needed for the log detail in the user's example. |
| 4 | **Frontend-only for the rest** — param search (key/value), log search + clear + counter, relative-time ("30s ago", 1s ticker), the global aggregate, and the summary panel — all client-side in `dashboard.html`, zero deps. | No backend needed; keep it simple. |
| 5 | **Task history depth** = last 20 per device (ring buffer). | `(defaulted: bounded memory)`. |
| 6 | **Global stats are accumulated at event time, not reduced at read time.** `CWMPSimulator` has its own **`_stats`** (same shape as a device's) and bumps it in `_wireDeviceEvents` as each `device:rpc`/inform/etc. is forwarded: counts `++`, recency `= now`. No reduction over devices, no `_retired` tally — just a running total. (Each device keeps its own `_stats` for its panel.) | User: keep it simple — "just a counter". |
| 7 | **Lifetime (cumulative) global** falls out of Decision 6 for free: because it's incremented when events happen, it's indifferent to add/remove (a removed device's increments are already in `simulator._stats`). The **"current/filtered"** total is a UI concern — sum the *visible* devices client-side. `/api/fleet` exposes `global = simulator._stats`. Resets on process restart (persistence is a separate future option). | User decision (Lifetime) + simplification. |

## Proposed architecture

```
CWMPDevice._stats {                         hooks
  rpc:    { <method>: count },              handleMethod → recv++  + lastRecv + emit device:rpc(recv)
  sent:   { <method>: count },              startSession/sendRequest → sent++ + lastSent
  informs, lastInform:<ts>,                 startSession → informs++ + lastInform
  failures, lastFault:{path,at},            SetParameterValues fail → failures++ + emit device:rpc(ok:false)
  tasks: [{type,result,at} …≤20]            finishTask → push; pending = _pendingTask.length
}
device.getStats() → serializable snapshot (+ pending)

CWMPSimulator._wireDeviceEvents → also forward 'rpc' → 'device:rpc'

dashboard.ts
  GET /api/devices/:serial → { …, stats: getStats() }
  GET /api/fleet           → { devices:[{serial,root,groupId,lastInform,informs,recv,failures}], global }

CWMPSimulator._stats { rpc:{}, sent:{}, informs, failures, lastInform, lastRecv, lastSent }   // global, lifetime
  _wireDeviceEvents: on each forwarded device:rpc/inform/… → _stats.<counter>++ , _stats.<recency> = now
  globalStats() → _stats           (running total since start; survives add/remove for free)
  UI: "current/filtered" = sum of visible devices' _stats (client-side)

dashboard.html (codegen)
  device summary panel (counters table, last recv/sent, pending, last 20 tasks) above the action buttons
  param search (filter table by name|value)   sidebar: "last inform 30s ago" (ticker) + global summary box
  log header: search box · clear button · event counter   feed shows device:rpc lines
```

## Phases

### Phase 1 — Lib metrics + `device:rpc` event + API — 🟢 SHIPPED

**Objective:** the device tracks its stats and exposes them; the bus carries RPC events. **Validation:** counters increment on RPC/inform/failure/task; `getStats()` shape; `device:rpc` forwarded; API returns stats. ✅ `test/metrics.test.ts` (9) + dashboard API tests; full suite **203 green**; `tsc` clean; live smoke verified.

- **`src/cwmp-device.ts`** — `_stats` + hooks in `handleMethod` (recv count/lastRecv + `device:rpc`), `startSession` (informs/lastInform/sent), `sendRequest` (sent), `finishTask` (task ring buffer); `getStats()` (snapshot + `pending: _pendingTask.length`); a `recordFault(path)` helper.
- **`src/cwmp-methods.ts`** — call `device.recordFault(path)` (or emit via the device) on a `SetParameterValues` write failure (count + `device:rpc` ok:false).
- **`src/cwmp-sim.ts`** — `_wireDeviceEvents` forwards `rpc` → `device:rpc` **and bumps `simulator._stats`** (counts `++`, recency `= now`) on each forwarded event; `globalStats()` returns `_stats`. No `_retired`, no fold-on-remove.
- **`dashboard.ts`** — `GET /api/devices/:serial` adds `stats`; `snapshot()` (`/api/fleet`) adds the per-device summary **+ `global: client.globalStats()`**; `wireFeed` forwards `device:rpc`.
- **Tests:** `test/metrics.test.ts` — device counters increment (recv/sent/fault/inform/task, `lastRecv`/`lastInform`/pending); `device:rpc` forwarded `{method,dir,ok}`; **global: `simulator._stats` accumulates across devices, and a removed device's earlier counts remain in `globalStats()`** (incremented at event time); `test/dashboard.test.ts` — `/api/devices/:serial` includes `stats`, `/api/fleet` includes the summary + `global`.

### Phase 2 — Dashboard: summary panel, sidebar age, global box — 🟢 SHIPPED

**Objective:** show the metrics live. **Validation:** selecting a device shows its summary; the sidebar shows last-inform age; the global box aggregates; the log shows `device:rpc` lines. ✅ Built in `dashboard.html`; `GET /` markers tested; live WS path smoke-verified.

- **`dashboard.html`** — device **summary panel** above the actions (counters table, last recv/sent RPC, pending + last-20 tasks); **sidebar** per-device "last inform Ns ago" via a 1s ticker (seeded from `/api/fleet`, bumped by feed `device:inform`); **global summary** box: renders `global` (lifetime, from `/api/fleet`) **and** a "current/filtered" total summed over the visible devices client-side; the feed renders `device:rpc` (`Received: X`, `✗ Failed: <path>`) and bumps the selected device's + global counters live.
- **Tests:** `GET /` still serves (markers for the new panels); endpoint shapes already covered in P1.

### Phase 3 — Searches + log controls — 🟢 SHIPPED

**Objective:** param + log search, clear, counter. **Validation:** filtering works; clear empties the feed; the counter tracks events. ✅ `GET /` markers tested (`logsearch`/`logclear`/`evcount`).

- [x] **`dashboard.html`** — **param search** input filtering the device table by key *or* value; **log header** (`#feedhead`) with a search box (`#logsearch`, filters visible lines), a **clear** button (`#logclear`), and an **event counter** (`#evcount`). The device panel now also has a per-device `stats` summary + last-N tasks; the sidebar shows live "Ns ago"; the global box shows lifetime · current.
- [x] **Tests:** `GET /` markers (search inputs, clear button, counter element); behavior is client-side (smoke-verified).
- [x] **`PENDING.md`** — dashboard metrics noted.

**Note (live updates):** the device panel refreshes on (re)select (avoids resetting the param-search box mid-type); the **global box + sidebar** update live via a debounced `/api/fleet` refetch on `device:rpc`/`device:inform` (1.5s) + the 1s relative-time ticker. UI authored in `dashboard.html` (codegen → `dashboard.generated.ts`).

## Risks & tradeoffs

- **Hook coverage / "sent" precision.** Received RPCs are clean (one `handleMethod` per request); "sent" is fuzzier (Inform + `<Method>Response` + faults) — track the outbound method name at the send points; document that "last sent" is best-effort.
- **Counter growth.** `rpc`/`sent` maps grow with distinct method names (bounded ~20 RPCs); task history capped at 20. No unbounded memory.
- **`device:rpc` volume.** Every RPC now emits a feed event — fine for one dashboard; for big fleets the client should cap the log (already plan to cap at ~300 lines) and the counter handles the rest.
- **Reset semantics.** Stats are per-process (reset on restart); they are *not* persisted with `exportState` (state = the data model, not telemetry). Note it; a future option could persist counters.
- **Global is a write-time running total** (`simulator._stats`, bumped per forwarded event — counts `++`, recency `= now`), not a read-time reduction. So lifetime/cumulative is automatic and add/remove-safe; it resets on process restart (counter persistence is a separate future option). The **current/filtered** total is summed in the UI over the visible devices.

## Resume state

- **Done:** **All 3 phases 🟢 shipped.** Lib `_stats` + hooks + `getStats()` + `device:rpc` + `recordFault`; simulator `_stats` (event-time, lifetime) + `globalStats()`; `dashboard.ts` `stats`/`global`/feed; `dashboard.html` summary panel + sidebar age + global box (lifetime·current) + param search + log search/clear/counter + `device:rpc` log lines. `test/metrics.test.ts` (9) + dashboard tests; full suite **203 green**; `tsc` clean; build ok; **deps `{}`**; live smoke verified.
- **Next action:** none. Follow-ups (noted): exact "sent" classification (re-parse outbound XML), counter persistence across restarts, `device:inform`-volume throttling for very large fleets.
- **Open questions:** None.
- **Watch out for:** keep the lib **pure/in-memory** (counters only, no I/O); `device:rpc` must fire from the single `handleMethod` receive point (avoid double-count in the recursive loop); cap task history + log lines.

## Final verification checklist

- [ ] `npm run check` clean; `npm test` green (`metrics` + extended `dashboard` tests); zero new deps.
- [ ] Device counters: per-RPC recv/sent, failures, informs, lastRecv/lastSent, lastInform, pending, last-20 tasks; `getStats()` serializable.
- [ ] `device:rpc {serial,method,dir,ok}` emitted (recv + failure) and forwarded as `device:rpc`.
- [ ] `GET /api/devices/:serial` includes `stats`; `GET /api/fleet` includes the per-device summary.
- [ ] Global = `simulator._stats` bumped at event time (lifetime); a removed device's earlier counts persist in `globalStats()`; exposed as `/api/fleet` `global`. "Current/filtered" total summed in the UI over visible devices.
- [ ] UI: device summary panel; sidebar "last inform Ns ago" (live); global summary box (lifetime + filtered); param search (key/value); log search + clear + counter; feed shows `Received: X` / failures.
- [ ] Status synced: this header, `00-dashboard.md`, `index.md`; PENDING noted.
