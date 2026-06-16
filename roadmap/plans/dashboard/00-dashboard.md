# dashboard — domain reference

A web dashboard + control API for a running simulator: observe the fleet and its
live `device:*` activity, and drive it (add/remove/restart groups, reboot devices,
trigger informs, set params) at runtime. PENDING Idea #16.

**Status:** ⚪ Not started · 🟡 In progress · 🟢 Shipped · 🔴 Blocked
_Check the box and set 🟢 when a plan ships. Keep these in sync with `../index.md`._

## Plans

- [x] 🟢 **01** — [Web dashboard + control API](./01-dashboard.md) · Priority: Medium — binary-side
  HTTP server (`dashboard.ts`): REST control mapped onto fleet/04's API + a hand-rolled WebSocket
  live feed of the `device:*` bus + one self-contained HTML page. `--dashboard` / `--dashboard-port`.
  _(Shipped — P1 REST, P2 WS feed, P3 UI/CLI; zero deps.)_
- [x] 🟢 **02** — [Metrics & observability](./02-metrics-observability.md) · Priority: Medium — per-device + global
  counters (per-RPC received, failures, informs), last recv/sent RPC, pending + recent tasks, last-inform age;
  device summary panel, param search, searchable/clearable/counted log; lib-tracked `_stats` + `device:rpc` event,
  simulator `_stats` (lifetime, event-time). _(Shipped — P1 lib/API, P2 UI panels/sidebar/global, P3 searches/log; zero deps.)_

## Direction

The dashboard is a **thin binary-side layer** over what fleet/04 already exposes (the `device:*`
EventEmitter + `addGroup`/`removeGroup`/`restartGroup`/`removeDevice`/`rebootDevice` + per-device
`get`/`set`/`getLeaves`/`onConnectionRequest`). The **library stays pure and IO-free** — `dashboard.ts`
lives at the repo root next to `storage.ts`/`models.ts`, takes a `CWMPSimulator` instance, and the lib
never imports it. **Zero runtime dependencies**: `node:http` + a hand-rolled RFC-6455 WebSocket server
(no `ws`); the UI is a single self-contained HTML string (vanilla JS, no framework/build).
