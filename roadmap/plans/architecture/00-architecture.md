# architecture — domain reference

Plans that reshape `cwmp-sim`'s structure: entry points, library surface, packaging, and how the
single-device engine is composed into larger runners (fleet, dashboard).

**Status:** ⚪ Not started · 🟡 In progress · 🟢 Shipped · 🔴 Blocked
_Check the box and set 🟢 when a plan ships. Keep these in sync with `../index.md`._

## Plans

- [ ] ⚪ **01** — [Entry / library refactor](./01-entry-lib-refactor.md) · Priority: High
  - Lib/CLI split: `src/index.ts` + `src/config.ts`, thin `main.ts`, public types via `types.ts`, `examples/`.

## Direction

The single-device engine (`src/cwmp-sim.ts`) is the reusable core. The roadmap layers on top of it
without forking it: a thin CLI (`main.ts`), a library entry (`src/index.ts`), and — in later plans —
a fleet runner (multi-device) and an optional dashboard. Each layer composes the engine; it does not
duplicate it. See `PENDING.md` (Ideas) for the feature backlog these plans draw from.
