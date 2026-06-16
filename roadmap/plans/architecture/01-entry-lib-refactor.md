<!--
Domain: architecture
Status: 🟢 Shipped
Priority: High
Created: 2026-06-14
Revalidated: 2026-06-14
Dependencies: —
Reference: ./00-architecture.md
-->

# ARCHITECTURE-01 — Entry / library refactor

_Status: 🟢 Shipped · Priority: High · Created: 2026-06-14_

## Goal

Make `cwmp-sim` cleanly usable **both** as an importable library and as a CLI, without changing
runtime behavior. Today the root `main.ts` is the npm `main`/`types` entry *and* the `bin` — but it
auto-starts a simulator on import (CLI side-effects), so it cannot be imported as a library. This plan
introduces a dedicated library entry (`src/index.ts`) exporting `CWMPSimulator`, `CWMPDevice`, and the
public option types; extracts env/CLI parsing into `src/config.ts`; reduces `main.ts` to a thin CLI
dispatcher; and ships the public types correctly. This is the foundation the later multi-device
(fleet) and dashboard work will build on. Multi-device itself is **out of scope** here.

## Reconnaissance

### Files read

- `main.ts` — root CLI entry. Has shebang `#!/usr/bin/env node`; builds `options` from `process.env` (lines 8-29) and a CLI arg loop for `--acs/--port/--ip/--serial` (lines 32-47); `new CWMPSimulator(options)` + `client.start()` (lines 50-52); console summary (lines 54-59); `SIGINT` handler that calls `client._device.exportCSV(...)` (lines 62-68).
- `src/cwmp-sim.ts` — `export default class CWMPSimulator`. `constructor(options: CwmpSimulatorOptions)` builds `_device`, `_httpClient`, and registers listeners; `start()` lazily creates the `CWMPConn` Connection Request server (port comes from `options.conn.port`) and calls `startSession("1 BOOT")`. This is the single-device engine and the intended library core.
- `src/cwmp-device.ts` — `export default class CWMPDevice`; `constructor(options: CwmpDeviceOptions)`; `exportCSV(path)` (placeholder). Imports `./types.d.ts`.
- `src/types.d.ts` — hand-written declaration module exporting `XmlNode`, `CwmpNode`, `ISimulator`, and the option types `CwmpSimulatorOptions`, `CwmpDeviceOptions`, `CwmpConnOptions`, `CwmpAcsOptions`.
- `src/config.ts` — `Not found: src/config.ts — searched src/ — does not exist yet; this plan creates it.`
- `src/index.ts` — `Not found: src/index.ts — searched src/ — does not exist yet; this plan creates it.`
- `package.json` — `main: ./dist/main.js`, `types: ./dist/main.d.ts`, `bin.cwmp-sim: dist/main.js`, `files: [dist, README.md, LICENSE]`; scripts include `build` (`tsc`), `check`, `test`, `prepack`, `prepublishOnly`, `release:dry`.
- `tsconfig.json` — `rootDir: "."`, `outDir: "dist"`, `declaration: true`, `include: ["src/**/*", "main.ts"]`. Output layout therefore is `dist/main.js` + `dist/src/*.js`. `src/index.ts`/`src/config.ts` will be auto-included via `src/**`. `test/` and (future) `examples/` are NOT in `include`.

### Searches performed

- `rg "from ['\"]\./types\.d\.ts['\"]" src` → 5 files import the types module: `cwmp-methods.ts`, `cwmp-device.ts`, `cwmp-soap.ts`, `cwmp-sim.ts`, `xml-parser.ts`.
- `rg "types.d.ts" main.ts` → `main.ts:6` imports `CwmpSimulatorOptions` from `./src/types.d.ts`. **Total blast radius: 6 files.**

### Runtime path

```
process.env + argv → main.ts (build options) → new CWMPSimulator(options) → start()
   → CWMPConn (CR server on conn.port) → startSession("1 BOOT") → CwmpHttp → ACS
package.json main/types/bin → dist/main.js  (consumer surface)
```

### Existing patterns to reuse

- `src/cwmp-model.ts` default-export-of-an-object pattern, and the `export default class` pattern used by `cwmp-sim.ts`/`cwmp-device.ts` — `index.ts` re-exports these defaults as named exports.
- `tsconfig` already emits declarations + `rewriteRelativeImportExtensions` (so `./x.ts` imports compile to `./x.js`), confirmed working for the existing build.

### Gaps

- `tsc` does not copy hand-written `.d.ts` files to `dist/`, so `dist/src/types.d.ts` is never emitted — a library re-exporting those types would dangle. Resolved by Decision 5 (rename to `types.ts`).
- No library entry / no `exports` map today; `main.ts` is import-unsafe due to auto-start side-effects.
- `examples/` dir does not exist; manual scratch scripts currently sit in `test/` as `test-*.ts`.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | Public API = `CWMPSimulator` + `CWMPDevice` + option types (named exports). Keep `methods`/`xml`/`model` internal. | User answer (Public API). |
| 2 | New `src/index.ts` is the lib entry. `main`/`types` → `dist/src/index.{js,d.ts}`; add an `exports` map locking the public API; `bin` stays `dist/main.js`; `src/cwmp-sim.ts` stays the engine. | User answer (Lib entry). |
| 3 | Multi-device/fleet is **out of scope**; single-device foundation only. No `runner.ts`, no `--count`. | User answer (Fleet seam). |
| 4 | Extract env + CLI parsing into `src/config.ts` (`buildOptions(env, argv)`), reusable by CLI and future fleet. | User answer (Config parse). |
| 5 | Rename `src/types.d.ts` → `src/types.ts` (type-only module) so `tsc` emits `dist/src/types.d.ts`; update the 6 imports. | User answer (Types shipping). |
| 6 | Move the 4 manual scratch scripts (`test-diag.ts`, `test-diagnostics.ts`, `test-igd.ts`, `test-windows.ts`) from `test/` to `examples/`. | User notes ("some scripts… to be stand alones examples"). |
| 7 | `SIGINT`/`exportCSV` handling stays in `main.ts` (CLI), never in the library. | `(defaulted: libraries must not capture process signals)`. |
| 8 | `index.ts` uses named exports only (no default export). | `(defaulted: cleaner named API; reversible)`. |
| 9 | `buildOptions(env = process.env, argv = process.argv.slice(2))` takes params (pure/testable). Config helpers are NOT part of the public lib surface. | `(defaulted: testability; stays within Decision 1's surface)`. |
| 10 | `examples/` is excluded from the published tarball (`files: [dist]` unchanged) and from `tsconfig` include (consistent with `test/`). | `(defaulted: matches current test/ handling)`. |

## Proposed architecture

- **Layer responsibilities:**
  - `src/index.ts` (NEW) — **library surface**. Re-exports `CWMPSimulator`, `CWMPDevice`, and option types. No side effects.
  - `src/config.ts` (NEW) — **config builder**. `buildOptions(env, argv)` → `CwmpSimulatorOptions`. Pure, no side effects beyond reading the args it's given.
  - `src/cwmp-sim.ts` — **engine** (unchanged). Single-device orchestrator.
  - `main.ts` — **CLI dispatcher** (thinned). `buildOptions()` → `new CWMPSimulator()` → `start()` → logs → `SIGINT`.
  - `examples/*.ts` — **manual scratch scripts** (run via `npx tsx examples/<file>.ts`).
- **Data flow:** `main.ts → config.buildOptions() → CWMPSimulator(options).start()` (behavior identical to today; only the wiring moves).
- **Source-of-truth files:** option/types contract = `src/types.ts` (renamed). Public surface = `src/index.ts`.
- **Package wiring:** `main`/`types` → `dist/src/index.*`; `exports` `"."` → index; `bin` → `dist/main.js` (file paths bypass the `exports` map, so the CLI is unaffected).

## Phases

### Phase 1 — Code restructure (lib core, config, thin entry)

**Objective:** Introduce the library entry + config module and make `main.ts` thin, with the public
types shipped correctly. **Expected result:** `npm run check` clean; `import('./dist/src/index.js')`
exposes `CWMPSimulator`/`CWMPDevice`; CLI behaves exactly as before.
**Validation:** `npm run check`, `npm test`, `npm run build`, import + CLI smoke (below).

#### Task: Rename `types.d.ts` → `types.ts` and update imports

- **Layer:** types/contract.
- **Files:**
  - `CREATE: src/types.ts` (identical content to current `src/types.d.ts`).
  - `DELETE: src/types.d.ts`.
  - `UPDATE: src/cwmp-methods.ts`, `src/cwmp-device.ts`, `src/cwmp-soap.ts`, `src/cwmp-sim.ts`, `src/xml-parser.ts` — replace `from "./types.d.ts"` → `from "./types.ts"`.
  - `UPDATE: main.ts:6` — `from './src/types.d.ts'` → `from './src/types.ts'`.
- **Reason:** A regular `.ts` type module is compiled by `tsc`, emitting `dist/src/types.d.ts` so the library's re-exported types resolve for consumers (a hand-written `.d.ts` is not copied to `dist/`).
- **Integration points:** All existing `import type { ... }` sites; no runtime change (types-only module → emits an effectively empty `dist/src/types.js`).
- **Data contracts:** unchanged — `XmlNode`, `CwmpNode`, `ISimulator`, `CwmpSimulatorOptions`, `CwmpDeviceOptions`, `CwmpConnOptions`, `CwmpAcsOptions`.
- **Code:**
  ```ts
  // src/xml-parser.ts (and the other 5 sites)
  import type { XmlNode } from "./types.ts";
  ```
- **Validation:** `npm run check` clean; after `npm run build`, `dist/src/types.d.ts` exists.

#### Task: Create `src/config.ts` (env + CLI → options)

- **Layer:** config.
- **Files:** `CREATE: src/config.ts`.
- **Reason:** Move the option-building logic out of `main.ts` (Decision 4) so the CLI and a future fleet share one builder; make it pure/testable (Decision 9).
- **Integration points:** Consumed by `main.ts`. Reads the same env vars and flags as today (`DEVICE_*`, `ACS_*`, `CONN_*`; `--acs/--port/--ip/--serial`).
- **Data contracts:** returns `CwmpSimulatorOptions` from `./types.ts`.
- **Code:**
  ```ts
  import type { CwmpSimulatorOptions } from "./types.ts";

  export function buildOptions(
    env: NodeJS.ProcessEnv = process.env,
    argv: string[] = process.argv.slice(2),
  ): CwmpSimulatorOptions {
    const options: CwmpSimulatorOptions = {
      device: {
        rootName: env["DEVICE_ROOT"] || "Device",
        serialNumber: env["DEVICE_SERIAL"] || "123456",
        oui: env["DEVICE_OUI"] || "000000",
        productClass: env["DEVICE_PRODUCT_CLASS"] || "Simulator",
        csvPath: env["DEVICE_CSV"] || "./models/data_model_test.csv",
        jsonPath: env["DEVICE_JSON"] || "./models/data_model_test.json",
      },
      acs: { url: env["ACS_URL"] || "http://localhost:7547/", user: env["ACS_USER"] || "", pass: env["ACS_PASS"] || "" },
      conn: { ssl: false, addr: env["CONN_ADDR"] || "0.0.0.0", port: parseInt(env["CONN_PORT"] || "7547"), user: env["CONN_USER"] || "", pass: env["CONN_PASS"] || "" },
    };
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--acs" && argv[i + 1]) options.acs.url = argv[++i];
      else if (argv[i] === "--port" && argv[i + 1]) options.conn.port = parseInt(argv[++i]);
      else if (argv[i] === "--ip" && argv[i + 1]) options.conn.addr = argv[++i];
      else if (argv[i] === "--serial" && argv[i + 1]) options.device.serialNumber = argv[++i];
    }
    return options;
  }
  ```
- **Validation:** unit-tested in Phase 2; `npm run check` clean.

#### Task: Create `src/index.ts` (library surface)

- **Layer:** library entry.
- **Files:** `CREATE: src/index.ts`.
- **Reason:** A side-effect-free import entry exposing the decided public API (Decision 1).
- **Integration points:** Becomes `package.json` `main`/`types`/`exports` target.
- **Data contracts:** re-exports option types from `./types.ts`.
- **Code:**
  ```ts
  export { default as CWMPSimulator } from "./cwmp-sim.ts";
  export { default as CWMPDevice } from "./cwmp-device.ts";
  export type {
    CwmpSimulatorOptions,
    CwmpDeviceOptions,
    CwmpConnOptions,
    CwmpAcsOptions,
  } from "./types.ts";
  ```
- **Validation:** after build, `node -e "import('./dist/src/index.js').then(m => console.log(Object.keys(m)))"` prints `[ 'CWMPSimulator', 'CWMPDevice' ]`.

#### Task: Thin `main.ts` to a CLI dispatcher

- **Layer:** CLI entry.
- **Files:** `UPDATE: main.ts:1-69` (replace the env/arg-building body; keep shebang, summary logs, and the `SIGINT`/`exportCSV` handler).
- **Reason:** `main.ts` should only parse → start → handle signals (Decisions 4, 7).
- **Integration points:** imports `buildOptions` from `./src/config.ts` and `CWMPSimulator` from `./src/cwmp-sim.ts`. Keeps the `bin` behavior identical.
- **Code:**
  ```ts
  #!/usr/bin/env node
  import CWMPSimulator from "./src/cwmp-sim.ts";
  import { buildOptions } from "./src/config.ts";

  const options = buildOptions();
  const client = new CWMPSimulator(options);
  client.start();

  console.log("Simulator started. Values:");
  console.log(`  ACS: ${options.acs.url}`);
  console.log(`  CPE: ${options.conn.addr}:${options.conn.port}`);
  console.log(`  Serial: ${options.device.serialNumber}`);
  console.log(`  Type: ${options.device.productClass}`);
  if (options.device.csvPath) console.log(`  CSV: ${options.device.csvPath}`);
  if (options.device.jsonPath) console.log(`  JSON: ${options.device.jsonPath}`);

  process.on("SIGINT", () => {
    console.log("\nStopping simulator...");
    if (client._device._csvPath) client._device.exportCSV(client._device._csvPath);
    process.exit();
  });
  ```
- **Validation:** `node dist/main.js --serial SMOKE` (after build) starts and logs the summary; `npm run dev` still works.

### Phase 2 — Packaging, examples, docs, validation

**Objective:** Point the package at the new entry, relocate scratch scripts, document library usage,
and prove everything still works + ships correctly. **Expected result:** `npm test` green,
`release:dry` tarball contains `dist/src/index.{js,d.ts}` + `dist/src/types.d.ts`.
**Validation:** full gate below.

#### Task: Update `package.json` entry + `exports`

- **Layer:** packaging.
- **Files:** `UPDATE: package.json` — `main` (line 6) → `./dist/src/index.js`; `types` (line 7) → `./dist/src/index.d.ts`; add an `exports` map; leave `bin` and `files` unchanged.
- **Reason:** Make the importable entry the library, not the CLI (Decision 2).
- **Integration points:** `import "cwmp-sim"` resolves to `dist/src/index.js`; deep imports of internals are blocked by the `exports` map; the `bin` path is a literal file, unaffected.
- **Code:**
  ```jsonc
  "main": "./dist/src/index.js",
  "types": "./dist/src/index.d.ts",
  "exports": {
    ".": { "types": "./dist/src/index.d.ts", "import": "./dist/src/index.js" },
    "./package.json": "./package.json"
  },
  ```
- **Validation:** `npm run release:dry` lists `dist/src/index.js`, `dist/src/index.d.ts`, `dist/src/types.d.ts`; no warnings.

#### Task: Move scratch scripts to `examples/`

- **Layer:** examples.
- **Files:** `CREATE: examples/`; move via `git mv` `test/test-diag.ts`, `test/test-diagnostics.ts`, `test/test-igd.ts`, `test/test-windows.ts` → `examples/`.
- **Reason:** Separate manual smoke scripts from CI unit tests (Decision 6); keeps `test/` = `*.test.ts` only.
- **Integration points:** Their imports use `../src/...` and `examples/` is the same depth as `test/`, so **no import edits needed**. Excluded from `npm test` (glob `test/**/*.test.ts`), the tarball (`files: [dist]`), and `tsconfig` (Decision 10).
- **Validation:** `npm test` still runs only the `*.test.ts` files (count unchanged); `npx tsx examples/test-diagnostics.ts` still runs.

#### Task: Add `test/config.test.ts`

- **Layer:** tests.
- **Files:** `CREATE: test/config.test.ts`.
- **Reason:** `buildOptions` is pure — lock its env + CLI precedence behavior.
- **Code:**
  ```ts
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { buildOptions } from "../src/config.ts";

  test("buildOptions reads env and applies CLI overrides", () => {
    const o = buildOptions({ ACS_URL: "http://acs/", DEVICE_SERIAL: "ENV1" }, ["--serial", "CLI1", "--port", "9000"]);
    assert.equal(o.acs.url, "http://acs/");
    assert.equal(o.device.serialNumber, "CLI1"); // CLI wins over env
    assert.equal(o.conn.port, 9000);
  });
  ```
- **Validation:** `npm test` includes it and passes.

#### Task: Update README (library usage + structure)

- **Layer:** docs.
- **Files:** `UPDATE: README.md` — add a "Use as a library" subsection; update the project-structure tree (`src/index.ts`, `src/config.ts`, thin `main.ts`, `examples/`); note `test/` = unit tests, `examples/` = manual scripts.
- **Reason:** Document the new dual CLI/library surface.
- **Code:**
  ```ts
  import { CWMPSimulator } from "cwmp-sim";
  const sim = new CWMPSimulator({
    device: { rootName: "InternetGatewayDevice", serialNumber: "SIM001" },
    acs: { url: "http://localhost:7547/acs", user: "", pass: "" },
    conn: { addr: "0.0.0.0", port: 7547, user: "", pass: "" },
  });
  sim.start();
  ```
- **Validation:** manual read; links resolve.

#### Task: Full validation gate

- **Layer:** validation.
- **Files:** none (commands).
- **Code:**
  ```bash
  npm run check
  npm test
  npm run clean && npm run build
  node -e "import('./dist/src/index.js').then(m => console.log(Object.keys(m)))"   # CWMPSimulator, CWMPDevice
  test -f dist/src/types.d.ts && head -1 dist/main.js                              # types emitted + shebang intact
  node dist/main.js --serial SMOKE & sleep 2; kill %1                              # CLI still starts
  npm run release:dry
  ```
- **Validation:** all pass; tarball has `dist/src/index.{js,d.ts}` + `dist/src/types.d.ts`; import prints both exports.

## Risks & tradeoffs

- **`exports` map encapsulation:** blocks consumers from deep-importing `cwmp-sim/dist/src/*`. Acceptable — package is unpublished, so there are no consumers to break; it's the intended public-API lock.
- **Type module rename:** the 6 import edits must all land or `npm run check` fails fast (good — no silent drift). The renamed module emits a near-empty `dist/src/types.js`; harmless.
- **`examples/` not type-checked:** consistent with current `test/` handling, but the scratch scripts can bitrot. Tracked as a known gap (a future plan could add them to a check).
- **Behavior parity:** no engine logic changes; the only behavioral surface is *where* options are built — covered by `test/config.test.ts` + CLI smoke.

## Resume state

- **Done so far:** Implemented and verified on 2026-06-14.
- **Next action:** None.
- **Open questions:** None.
- **Watch out for:** Future changes should keep `main.ts` CLI-only and `src/index.ts` side-effect-free.

## Final verification checklist

- [x] All phases' validation steps pass.
- [x] `npm run check` clean.
- [x] `npm test` green (65 tests including new `config.test.ts`).
- [x] `import('./dist/src/index.js')` exposes `CWMPSimulator` and `CWMPDevice`; `dist/src/types.d.ts` exists.
- [x] `node dist/main.js --serial …` still starts the CLI; `dist/main.js` line 1 is the shebang.
- [x] `npm run release:dry` tarball includes `dist/src/index.{js,d.ts}` + `dist/src/types.d.ts`; no `bin`/pkg warnings.
- [x] `examples/` holds the 4 moved scripts; `test/` holds only `*.test.ts`.
- [x] `index.md` status updated.

