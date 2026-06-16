# fleet — domain reference

Running **many** simulated CPEs at once: the shared Connection Request server, the per-device
orchestration, device templates (types), and per-device persisted state.

**Status:** ⚪ Not started · 🟡 In progress · 🟢 Shipped · 🔴 Blocked
_Check the box and set 🟢 when a plan ships. Keep these in sync with `../index.md`._

## Plans

- [x] 🟢 **01** — [Multi-device runtime](./01-multi-device-runtime.md) · Priority: High — N path-routed self-running devices behind one shared `CWMPConn`; `--count`; staggered boot. _(Shipped.)_
- [x] 🟢 **02** — [Device models](./02-device-templates.md) · Priority: High — CSV/JSON device **models** (ZTE/Huawei…) in `/models`; mixed fleets via **grouped flags** (`--model <name> --count N` repeated); model base + injected required nodes + identity overlay. _(Shipped — P1 loader, P2 device-consume, P3 grouped composition; shipped as `--model` not `--template`.)_
- [x] 🟢 **03** — [Device state persistence](./03-device-state.md) · Priority: High — per-device **State** layer: persist writable params across restarts. IO-free lib (`exportState`/`importState` + `device:save`/`device:load` events, BYO storage); binary file store in root `storage.ts` under `--storage-dir` (default `~/.cwmp-sim/devices/`), keyed by serial. Save on stop + after each session (dirty-gated) + explicit API. _(Shipped — P1 lib, P2 simulator bus/auto-save, P3 `storage.ts`.)_
- [x] 🟢 **04** — [Dynamic control + event bus](./04-dynamic-control.md) · Priority: High — runtime fleet control on the `addGroup` seam: `addGroup` returns a handle (`{id, devices, remove(), restart()}`), `removeGroup`/`restartGroup` + per-device `removeDevice`/`rebootDevice`; broadened `device:*` bus (`add`/`remove`/`boot`/`session`/`inform`/`diagnostic` + existing `save`/`load`). The keystone the #16 dashboard consumes. _(Shipped — P1 control API, P2 lifecycle bus.)_

## Direction

Layered model: **Model** (device type, from `/models/*.csv|json`) → **State** (per-device persisted values)
→ **Runtime** (live `CWMPDevice`). Plan 01 built the **runtime** (N clones of one type); plan 02 added
device **models** (multiple types: ZTE/Huawei via our own CSV/JSON loader) + grouped-flag mixed fleets.
Next: per-device **state** persistence (**fleet/03**, with `device:save`/`load` events) and a dynamic
fleet-control API + `device:*` event bus (**fleet/04**, on plan 02's `addGroup` seam), feeding a future
dashboard (#16). Decision: **in-process** fleet (not fork-per-device like genieacs-sim) — it fits the
async, self-running device and enables that dashboard.

> Naming: the device-type-from-file feature shipped as **`model`** (`--model`, `/models`), not `template`
> — see fleet/02 Decision 13. The `{i}` identity templating is a separate, unrelated "template".
