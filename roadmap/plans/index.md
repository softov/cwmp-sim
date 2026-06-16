# Plans index

Development plans for `cwmp-sim`, grouped by domain. Each plan is implementation-ready dev
documentation produced via the `planner` skill. Template: [`_TEMPLATE.md`](./_TEMPLATE.md).

**Status:** ⚪ Not started · 🟡 In progress · 🟢 Shipped · 🔴 Blocked

## architecture

Reference: [`00-architecture.md`](./architecture/00-architecture.md)

| # | Plan | Status | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 01 | [Entry / library refactor](./architecture/01-entry-lib-refactor.md) | 🟢 Shipped | High | — |

## enhancements

Reference: [`00-enhancements.md`](./enhancements/00-enhancements.md)

| # | Plan | Status | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 01 | [Pre-fleet enhancements](./enhancements/01-pre-fleet-enhancements.md) | 🟢 Shipped | Medium | architecture/01 (🟢) |
| 01·P2 | [Cross-platform diagnostics](./enhancements/01-pre-fleet-enhancements-p2-cross-platform-diagnostics.md) | 🟢 Shipped | Medium | — |
| 01·P3 | [Serial/MAC templating](./enhancements/01-pre-fleet-enhancements-p3-serial-mac-templating.md) | 🟢 Shipped | Medium | — |
| 02 | [Logging subsystem](./enhancements/02-logging-subsystem.md) | 🟢 Shipped | High | architecture/01 (🟢) |

## fleet

Reference: [`00-fleet.md`](./fleet/00-fleet.md)

| # | Plan | Status | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 01 | [Multi-device runtime](./fleet/01-multi-device-runtime.md) | 🟢 Shipped | High | architecture/01, enhancements/01·P3, enhancements/02 (all 🟢) |
| 02 | [Device models (templates)](./fleet/02-device-templates.md) | 🟢 Shipped | High | fleet/01 (🟢), enhancements/01·P3 (🟢) |
| 03 | [Device state persistence](./fleet/03-device-state.md) | 🟡 In progress (P1 🟢) | High | fleet/02 (🟢) |

## docs

Reference: [`00-docs.md`](./docs/00-docs.md)

| # | Plan | Status | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 01 | [Docs & per-RPC reference](./docs/01-docs-and-rpc-reference.md) | ⚪ Not started | Medium | — |

