<!--
Domain: enhancements
Status: 🟢 Shipped
Priority: Medium
Created: 2026-06-15
Revalidated: 2026-06-15
Dependencies: ./01-pre-fleet-enhancements.md (parent)
Reference: ./00-enhancements.md
-->

# ENHANCEMENTS-01·P3 — Serial/MAC templating

_Status: 🟢 Shipped · Priority: Medium · Created: 2026-06-15_

Child of [01-pre-fleet-enhancements](./01-pre-fleet-enhancements.md). See the parent for full
Reconnaissance. Ships on its own; it is the direct groundwork for multi-device (the fleet runner will
set `device.index` per device).

## Goal

Derive per-device identities from an index so a future fleet can spin up N unique CPEs. Add a
`device.index` (default `0`) and make `device.serialNumber`, `device.oui`, and a new `device.mac`
accept a `{i}` token (with zero-pad `{i:04}` and offset `{i+100}`). Wire `device.mac` into the
data-model's `MACAddress` leaf. For a single device this resolves with `index = 0`; multi-device
later just varies the index.

## Decisions locked in (relevant subset)

| # | Decision | Source |
|---|----------|--------|
| 1 | Template syntax: `{i}`, zero-pad `{i:04}`, offset `{i+100}` (combinable `{i+100:04}`); resolved against `device.index` (default `0`). | Parent D3. |
| 2 | Templatable fields: `device.serialNumber`, `device.oui`, `device.mac` only. | Parent D5. |
| 3 | Add `device.mac` (`DEVICE_MAC`/`--mac`) + inject into the model `MACAddress` leaf **where it exists** (check before force-set). | Parent D4, D8. |
| 4 | TR-181 minimal tree has no `MACAddress` leaf → MAC injection is a documented no-op for `Device` root until the model grows. | Parent recon / Gaps. |

## Tasks

#### Task: Extend the device option types

- **Layer:** types/contract.
- **Files:** `UPDATE: src/types.ts` — add to `CwmpDeviceOptions`.
- **Data contracts:**
  ```ts
  export type CwmpDeviceOptions = {
    manufacturer?: string;
    rootName?: string;
    oui?: string;
    productClass?: string;
    serialNumber?: string;
    csvPath?: string;
    jsonPath?: string;
    mac?: string;     // NEW (templatable)
    index?: number;   // NEW (default 0)
  };
  ```
- **Validation:** `npm run check` clean.

#### Task: Create the template resolver

- **Layer:** config.
- **Files:** `CREATE: src/config/template.ts`.
- **Reason:** Pure, testable token substitution shared by the parser.
- **Code:**
  ```ts
  // Supports {i}, {i:04} (zero-pad), {i+100} (offset), {i+100:04} (both).
  export function applyTemplate(value: string, index: number): string {
    if (typeof value !== "string" || !value.includes("{i")) return value;
    return value.replace(/\{i(?:\+(\d+))?(?::(\d+))?\}/g, (_m, offset, pad) => {
      let n = index + (offset ? parseInt(offset, 10) : 0);
      let s = String(n);
      if (pad) s = s.padStart(parseInt(pad, 10), "0");
      return s;
    });
  }
  ```
- **Validation:** unit tests below.

#### Task: Register `device.index` + `device.mac` fields

- **Layer:** config.
- **Files:** `UPDATE: src/config/fields.ts` (append to `configFields`).
- **Code:**
  ```ts
  {
    path: "device.index", env: "DEVICE_INDEX", flag: "--index",
    label: "Device index (resolves {i} in identity fields)", default: 0, parse: asInt
  },
  {
    path: "device.mac", env: "DEVICE_MAC", flag: "--mac",
    label: "Device MAC address (templatable, injected into the model)", default: "", parse: asString
  },
  ```
- **Validation:** `--help` lists both; `buildOptions` populates `device.index`/`device.mac`.

#### Task: Resolve templates in `buildOptions`

- **Layer:** config.
- **Files:** `UPDATE: src/config/parser.ts` — after the `for (const field of configFields)` loop, before `return`.
- **Reason:** Templating needs the resolved `device.index`, which is cross-field, so it runs as a post-process pass.
- **Integration points:** mutates `options.device.{serialNumber,oui,mac}` in place.
- **Code:**
  ```ts
  import { applyTemplate } from "./template.ts";
  // …after the field loop:
  const dev = (options.device ??= {}) as Record<string, any>;
  const idx = typeof dev.index === "number" ? dev.index : 0;
  for (const key of ["serialNumber", "oui", "mac"]) {
    if (typeof dev[key] === "string") dev[key] = applyTemplate(dev[key], idx);
  }
  ```
- **Validation:** `buildOptions({}, ["--serial", "SIM-{i}", "--index", "7"]).device.serialNumber === "SIM-7"`.

#### Task: Inject `device.mac` into the model

- **Layer:** device.
- **Files:** `UPDATE: src/cwmp-device.ts` — store `this._mac = options.mac || ""` in the constructor; after the root tree is built (`defaultTR98()`/`defaultTR181()`), set the MAC leaf if present.
- **Reason:** Make `device.mac` actually appear in `GetParameterValues`/Inform, not just config.
- **Integration points:** uses the existing `findNode`/`set(path, val, force=true)`; **guard with `findNode` so a missing leaf is not force-created** (TR-181 case).
- **Code:**
  ```ts
  // constructor:
  if (options.mac) this._mac = options.mac;
  // after building this._rootTree:
  if (this._mac) {
    const macPaths = this._rootName === "InternetGatewayDevice"
      ? ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress"]
      : []; // TR-181 minimal tree has no MACAddress leaf yet
    for (const p of macPaths) {
      const node = this.findNode(p);
      if (node && (node as any)._value !== undefined) this.set(p, this._mac, true);
    }
  }
  ```
- **Validation:** with root `InternetGatewayDevice` and `--mac AA:BB:CC:DD:EE:FF`, `device.getValue("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress") === "AA:BB:CC:DD:EE:FF"`.

#### Task: Tests

- **Layer:** tests.
- **Files:** `CREATE: test/template.test.ts`; `UPDATE: test/config.test.ts`.
- **Code:**
  ```ts
  // template.test.ts
  import { applyTemplate } from "../src/config/template.ts";
  test("applyTemplate handles token, pad, offset", () => {
    assert.equal(applyTemplate("SIM-{i}", 7), "SIM-7");
    assert.equal(applyTemplate("SIM-{i:04}", 7), "SIM-0007");
    assert.equal(applyTemplate("{i+100}", 5), "105");
    assert.equal(applyTemplate("dev-{i+10:03}", 5), "dev-015");
    assert.equal(applyTemplate("nochange", 9), "nochange");
  });
  // config.test.ts (add)
  test("buildOptions resolves identity templates with device.index", () => {
    const o = buildOptions({}, ["--serial", "SIM-{i}", "--mac", "AA:{i:02}", "--index", "7"]);
    assert.equal(o.device.serialNumber, "SIM-7");
    assert.equal(o.device.mac, "AA:07");
    assert.equal(o.device.index, 7);
  });
  ```
- **Validation:** `npm test` green.

#### Task: Document it

- **Layer:** docs.
- **Files:** `UPDATE: README.md` (Configuration: `DEVICE_INDEX`/`--index`, `DEVICE_MAC`/`--mac`; a "Templated identities" note with the `{i}` syntax).
- **Validation:** manual read.

## Risks & tradeoffs

- **MAC on TR-181** is a no-op until the model adds a `MACAddress`/`Ethernet.Interface` leaf (PENDING Idea #12). Documented in README + Decision 4; not blocking — TR-098 (the default in `.env`) works.
- **Templating only the three identity fields** is deliberate; broadening later is trivial (add field names to the post-process list).
- **`device.index` value source** is config-only now; the fleet runner (future) will set it per spawned device — no API lock-in here.

## Resume state

- **Done so far:** **Shipped ✅** — `src/config/template.ts` (`applyTemplate`: `{i}`/`{i:NN}`/`{i+NN}`/combined); `CwmpDeviceOptions` gained `mac`/`index`; `device.index` + `device.mac` config fields; `buildOptions` post-processes `serialNumber`/`oui`/`mac` through `applyTemplate(idx)`; `CWMPDevice` injects `_mac` into the TR-098 `MACAddress` leaf via a guarded `applyMac()` (runs at end of constructor, after `listeners` exists). Tests: `test/template.test.ts` (6) + 2 config assertions. README documents `DEVICE_INDEX`/`DEVICE_MAC`/`--index`/`--mac` + a Templated-identities table. **89 tests pass, `npm run check` clean.** Verified: `--serial SIM-{i} --index 5` → `SIM-5`; MAC `AA:BB:CC:DD:EE:05` injected into the model; TR-181 MAC is a no-op (no crash).
- **Next action:** None — shipped. This is the groundwork the fleet runner will drive (set `device.index` per spawned device).
- **Open questions:** None.
- **Watch out for:** `applyMac()` must run after `this.listeners` is initialized (it `set()`s, which fires events). Template resolution runs after the field loop in `buildOptions` (needs `device.index`).

## Final verification checklist

- [x] `npm run check` clean; `npm test` green (89, incl. `template.test.ts` + config assertions).
- [x] `--serial "SIM-{i}" --index 5` → serial `SIM-5`; `--mac` injected into the TR-098 `MACAddress` leaf.
- [x] TR-181 MAC no-op is documented (no phantom node created).
- [x] README documents `--index`/`--mac` + the `{i}` syntax.
- [x] Status synced: this header, `00-enhancements.md`, parent phase map, `index.md`.
