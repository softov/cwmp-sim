# enhancements — domain reference

Small, independently-shippable improvements that harden `cwmp-sim` — observability, portability, and
device-identity — without large architectural change. Several are groundwork before the multi-device
(fleet) work.

**Status:** ⚪ Not started · 🟡 In progress · 🟢 Shipped · 🔴 Blocked
_Check the box and set 🟢 when a plan ships. Keep these in sync with `../index.md`._

## Plans

- [x] 🟢 **01** — [Pre-fleet enhancements](./01-pre-fleet-enhancements.md) · Priority: Medium — parent of:
  - [x] 🟢 **01·P2** — [Cross-platform diagnostics](./01-pre-fleet-enhancements-p2-cross-platform-diagnostics.md)
  - [x] 🟢 **01·P3** — [Serial/MAC templating](./01-pre-fleet-enhancements-p3-serial-mac-templating.md)
- [x] 🟢 **02** — [Logging subsystem](./02-logging-subsystem.md) · Priority: High — per-instance level-based logger; replaced console.* across `src/`; subsumes the old SOAP wire-log (now `trace` level). _(Shipped.)_

## Direction

These plug into the existing declarative config registry (`src/config/fields.ts` → `buildOptions`) and
the diagnostics task pattern. **Plan 02 (logging)** is foundational — its per-instance logger is what
multi-device will use to keep each device's output distinct. P3 (serial/MAC templating) is direct
groundwork for multi-device (PENDING Idea #1): it adds the `device.index` + templating mechanism a
fleet runner will drive per device.
