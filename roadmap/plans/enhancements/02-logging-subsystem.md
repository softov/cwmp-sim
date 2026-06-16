<!--
Domain: enhancements
Status: 🟢 Shipped
Priority: High
Created: 2026-06-15
Revalidated: 2026-06-15
Dependencies: roadmap/plans/architecture/01-entry-lib-refactor.md (🟢 Shipped)
Reference: ./00-enhancements.md
-->

# ENHANCEMENTS-02 — Logging subsystem

_Status: 🟢 Shipped · Priority: High · Created: 2026-06-15_

<!-- Status legend: ⚪ Not started · 🟡 In progress / Partial · 🟢 Shipped · 🔴 Blocked.
     When status changes, update it in THREE places: this header, ./00-enhancements.md, and ../index.md. -->

## Goal

Replace the 109 hardcoded `console.log`/`console.error` calls scattered across `src/` with a proper,
**per-instance, level-based logger** so `cwmp-sim` behaves well as a library: imported code is silent
unless configured, the CLI prints useful `info` output, consumers can raise/lower verbosity or inject
their own logger (pino/winston/etc.), and SOAP envelope dumps live at a dedicated `trace` level. This
supersedes the original P1 "SOAP wire-log" child plan — the wire-log becomes one `trace`-level use of
the logger.

## Reconnaissance

### Files read / searched

- `rg -c "console\.(log|error|warn|info|debug)" src` → **109 calls in 12 files**: `cwmp-methods.ts` (22), `cwmp-sim.ts` (17), `task-upload.ts` (11), `diag-ping.ts` (11), `cwmp-device.ts` (9), `diag-download.ts` (8), `task-download.ts` (6), `diag-upload.ts` (6), `diag-traceroute.ts` (6), `cwmp-conn.ts` (5), `diag-wifi.ts` (4), `cwmp-http.ts` (4). Breakdown: 87 `console.log`, 22 `console.error`.
- `src/cwmp-sim.ts` — `CWMPSimulator` constructs `new CWMPDevice(options.device)`, `new CwmpHttp({...})`, and (in `start()`) `new CWMPConn(url, conn)`. `sendRequest(xml)` is the ACS chokepoint (envelope source). This class is the natural owner of the per-instance logger.
- `src/cwmp-device.ts` — `CWMPDevice` builds the `_diag` task objects (`DiagPing`, etc.) in its constructor; tasks hold `this._device`, so they can reach a device-held logger.
- `src/cwmp-task.ts` — base `CWMPTask` stores `this._device`; all diag/task subclasses log via `this._device`.
- `src/cwmp-methods.ts` — RPC handlers are free functions `(device, request)`; they reach the logger via `device`.
- `src/cwmp-http.ts` — `CwmpHttp` constructor takes a params object (easy to add a `logger`). `requestWithDigest` is a free function (logs via passed option or stays console for low-level transport — see Decisions).
- `src/cwmp-conn.ts` — `CWMPConn` constructor `(url, connOptions)`; add a logger param.
- `src/config/fields.ts` / `parser.ts` — declarative field registry; add a `log.level` field + an `asLogLevel` parser. `buildOptions` is CLI-only (not in the public lib surface per architecture-01).
- `src/types.ts` — `CwmpSimulatorOptions = { device, conn, acs }`; no `log` section; `CwmpDeviceOptions` has no `logger`.
- `main.ts` — thin CLI; passes `buildOptions()` result to `CWMPSimulator`.

### Runtime path

```
CLI:  buildOptions (log.level default "info") → CWMPSimulator(options) → createLogger(info) → this._log
lib:  new CWMPSimulator({...no log...}) → createLogger(silent) → this._log   (quiet by default)
      this._log → CWMPDevice._log → tasks (this._device._log) ; → CwmpHttp._log ; → CWMPConn._log
envelopes: sendRequest(xml) → this._log.trace("→/←", xml)   (visible only at level=trace)
```

### Existing patterns to reuse

- `src/config/fields.ts` field objects + `asBool`/`asInt` parsers — add `log.level` + `asLogLevel` the same way (`--help` updates free).
- `test/*.test.ts` `node:test` style — add `test/logger.test.ts` (pure, sink-captured).

### Gaps

- No logging abstraction; every module calls `console` directly → no level control, noisy when embedded.
- `CwmpHttp`/`CWMPConn` don't receive any context object beyond their config — need a `logger` threaded in.

## Decisions locked in

| # | Decision | Rationale / source |
|---|----------|--------------------|
| 1 | **Per-instance logger**: `CWMPSimulator` owns `this._log`; threads it into `CWMPDevice`, `CwmpHttp`, `CWMPConn`. Tasks/handlers reach it via `device._log`. | User answer (Logger model). |
| 2 | **Default level: silent for library, info for CLI.** Programmatic `new CWMPSimulator({…})` with no `log` → silent. `buildOptions` defaults `log.level="info"`, so the CLI is `info`. | User answer (Default level). |
| 3 | **Custom logger injection**: `options.log.logger` accepts any object implementing the `Logger` interface; used as-is. Else the built-in console logger is created from `options.log.level`/`sink`. | User answer (Custom logger). |
| 4 | **Levels (verbosity order):** `silent < error < warn < info < debug < trace`. SOAP envelopes log at `trace`. The original `--wire-log` flag is **dropped** in favor of `--log-level trace`. | User answer (Wire-log → trace). |
| 5 | Level→call mapping: `console.error` → `log.error`; lifecycle messages (started, server listening, session start, `Received: <RPC>`) → `log.info`; everything else (`Set X to Y`, dispatch, parsing, per-task chatter) → `log.debug`. | `(defaulted: sensible mapping; applied per-call with judgment)`. |
| 6 | `requestWithDigest` (low-level transport free function) takes an optional `logger` param; callers pass `this._log`. If absent it falls back to `NULL_LOGGER` (silent), **not** console. | `(defaulted: keep transport quiet by default)`. |
| 7 | Built-in sink writes via `console.error` (error), `console.warn` (warn), else `console.log`, prefixed `[level]` and an optional instance prefix (e.g. device serial). | `(defaulted: console-backed default; prefix aids multi-device)`. |
| 8 | `CwmpDeviceOptions` gains `logger?: Logger` so `CWMPDevice` can be constructed standalone (tests) with or without a logger; default `NULL_LOGGER`. | `(defaulted: testability + threading)`. |

## Proposed architecture

- **`src/logger.ts` (NEW)** — `LogLevel` type, `Logger` interface (`error/warn/info/debug/trace`), `createLogger(opts)` (level-filtered, console-backed or custom `sink`), and `NULL_LOGGER` (silent). Pure, no other deps.
- **`src/types.ts`** — `CwmpLogOptions { level?; logger?; prefix?; sink? }`; `log?` on `CwmpSimulatorOptions`; `logger?` on `CwmpDeviceOptions`.
- **`src/config/fields.ts`** — `log.level` field (`LOG_LEVEL`/`--log-level`, default `"info"`, `asLogLevel`).
- **Engine** — `CWMPSimulator` builds `this._log` from `options.log` and threads it to device/http/conn. `CWMPDevice._log` is read by all tasks/handlers.
- **Source-of-truth files:** logger contract = `src/logger.ts`; options = `src/types.ts`.

This plan has three phases; each ships and validates on its own.

## Phases

### Phase 1 — Logger core + config + CLI wiring

**Objective:** A working, configurable logger; CLI defaults to `info`, lib defaults to silent — without
yet migrating the 109 calls. **Validation:** `npm run check`, `npm test`, logger unit tests.

#### Task: Create `src/logger.ts`

- **Layer:** logger core.
- **Files:** `CREATE: src/logger.ts`.
- **Code:**
  ```ts
  export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";
  const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };
  export const LOG_LEVELS = Object.keys(ORDER) as LogLevel[];

  export interface Logger {
    error(...a: unknown[]): void;
    warn(...a: unknown[]): void;
    info(...a: unknown[]): void;
    debug(...a: unknown[]): void;
    trace(...a: unknown[]): void;
  }

  export type LoggerOptions = {
    level?: LogLevel;
    prefix?: string;
    sink?: (level: Exclude<LogLevel, "silent">, args: unknown[]) => void;
  };

  function defaultSink(level: Exclude<LogLevel, "silent">, args: unknown[]) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${level}]`, ...args);
  }

  export function createLogger(opts: LoggerOptions = {}): Logger {
    const threshold = ORDER[opts.level ?? "silent"];
    const sink = opts.sink ?? defaultSink;
    const pfx = opts.prefix ? [opts.prefix] : [];
    const at = (name: Exclude<LogLevel, "silent">) =>
      (...args: unknown[]) => { if (ORDER[name] <= threshold) sink(name, [...pfx, ...args]); };
    return { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug"), trace: at("trace") };
  }

  export const NULL_LOGGER: Logger = createLogger({ level: "silent" });
  ```
- **Validation:** unit tests below.

#### Task: Add log option types

- **Layer:** types.
- **Files:** `UPDATE: src/types.ts`.
- **Code:**
  ```ts
  import type { Logger, LogLevel } from "./logger.ts";
  export type CwmpLogOptions = { level?: LogLevel; logger?: Logger; prefix?: string;
    sink?: (level: Exclude<LogLevel, "silent">, args: unknown[]) => void };
  // CwmpSimulatorOptions: add  log?: CwmpLogOptions
  // CwmpDeviceOptions:    add  logger?: Logger
  ```
- **Validation:** `npm run check` clean.

#### Task: Register `log.level` config field

- **Layer:** config.
- **Files:** `UPDATE: src/config/fields.ts`.
- **Code:**
  ```ts
  import { LOG_LEVELS, type LogLevel } from "../logger.ts";
  const asLogLevel = (v: string): LogLevel => {
    if ((LOG_LEVELS as string[]).includes(v)) return v as LogLevel;
    throw new Error(`Invalid log level: ${v} (expected ${LOG_LEVELS.join("|")})`);
  };
  // field:
  { path: "log.level", env: "LOG_LEVEL", flag: "--log-level",
    label: "Log level (silent|error|warn|info|debug|trace)", default: "info", parse: asLogLevel },
  ```
- **Validation:** `buildOptions({}, []).log.level === "info"`; `--log-level debug` → `"debug"`; bad value throws.

#### Task: Build the logger in the engine

- **Layer:** engine.
- **Files:** `UPDATE: src/cwmp-sim.ts` — add `this._log` in the constructor (no migration of other calls yet in this phase).
- **Code:**
  ```ts
  import { createLogger, NULL_LOGGER, type Logger } from "./logger.ts";
  _log: Logger = NULL_LOGGER;
  // in constructor:
  this._log = options.log?.logger
    ?? createLogger({ level: options.log?.level, prefix: options.log?.prefix, sink: options.log?.sink });
  ```
- **Validation:** lib `new CWMPSimulator({device,conn,acs})` (no `log`) → `this._log` is silent; CLI path → info.

#### Task: Logger unit tests

- **Layer:** tests.
- **Files:** `CREATE: test/logger.test.ts`; `UPDATE: test/config.test.ts`.
- **Code:**
  ```ts
  import { createLogger, NULL_LOGGER } from "../src/logger.ts";
  test("level filters messages", () => {
    const seen: string[] = [];
    const log = createLogger({ level: "info", sink: (lvl) => seen.push(lvl) });
    log.error("x"); log.warn("x"); log.info("x"); log.debug("x"); log.trace("x");
    assert.deepEqual(seen, ["error", "warn", "info"]);
  });
  test("silent emits nothing", () => {
    let n = 0; const log = createLogger({ level: "silent", sink: () => n++ });
    log.error("x"); log.trace("x"); assert.equal(n, 0);
  });
  test("prefix is prepended", () => {
    let got: unknown[] = []; const log = createLogger({ level: "trace", prefix: "[SN1]", sink: (_l, a) => (got = a) });
    log.info("hello"); assert.deepEqual(got, ["[SN1]", "hello"]);
  });
  // config.test.ts: assert --log-level parsed + invalid throws
  ```
- **Validation:** `npm test` green.

**Expected result:** logger exists, is configurable, CLI=info / lib=silent; nothing else migrated yet.

### Phase 2 — Migrate the 109 `console.*` calls

**Objective:** Every `src/` module logs through the per-instance logger; no `console.*` left in `src/`
(except `src/logger.ts`'s own sink). **Validation:** `rg "console\." src` → only `logger.ts`; tests green.

#### Task: Thread the logger into device / http / conn

- **Layer:** engine plumbing.
- **Files:** `UPDATE: src/cwmp-sim.ts`, `src/cwmp-device.ts`, `src/cwmp-http.ts`, `src/cwmp-conn.ts`.
- **Reason:** these classes own the logger reference the rest reach through.
- **Integration points:**
  - `CWMPSimulator` passes `this._log` to `new CWMPDevice({ ...options.device, logger: this._log })`, to `CwmpHttp` (params `.logger`), and to `new CWMPConn(url, conn, this._log)`.
  - `CWMPDevice` constructor: `this._log = options.logger ?? NULL_LOGGER`; diag tasks read `this._device._log`.
  - `CwmpHttp` constructor: store `this._log = params.logger ?? NULL_LOGGER`; pass `logger` into `requestWithDigest`.
  - `CWMPConn` constructor: add `logger` param → `this._log`.
- **Validation:** `npm run check` clean; constructing `CWMPDevice` in existing tests still works (logger defaults to `NULL_LOGGER`).

#### Task: Replace `console.*` per the level mapping

- **Layer:** all 12 src modules.
- **Files:** `UPDATE:` `cwmp-methods.ts`, `cwmp-sim.ts`, `task-upload.ts`, `diag-ping.ts`, `cwmp-device.ts`, `diag-download.ts`, `task-download.ts`, `diag-upload.ts`, `diag-traceroute.ts`, `cwmp-conn.ts`, `diag-wifi.ts`, `cwmp-http.ts`.
- **Reason:** apply Decision 5 mapping; reach the logger via the right reference (`this._log` / `this._device._log` / `device._log`).
- **Code (representative):**
  ```ts
  // cwmp-sim.ts
  console.log(`[${sn}] Starting session with event: ${event}`);   →  this._log.info(`Starting session: ${event}`, sn);
  // cwmp-device.ts set()
  console.log(`Set ${path} to ${value}`);                          →  this._log.debug(`Set ${path} to ${value}`);
  // cwmp-methods.ts handlers
  console.log(`Received: ${methodName}`);                          →  device._log.info(`Received: ${methodName}`);
  console.error("❌ Download failed: URL is required");            →  device._log.error("Download failed: URL is required");
  // diag-ping.ts (reaches via device)
  console.log("Starting Ping Diagnostic...");                      →  this._device._log.debug("Starting Ping Diagnostic...");
  ```
- **Validation:** `rg "console\." src | rg -v "src/logger.ts"` → empty; `npm test` green; existing test suites unaffected (they construct devices without a logger → silent).

**Expected result:** full level control; default CLI shows lifecycle (`info`) without the old debug spam.

### Phase 3 — SOAP envelope tracing

**Objective:** Raw envelopes visible at `--log-level trace` (the wire-log, on the logger).
**Validation:** running at `trace` shows →/← envelopes; at `info` it does not.

#### Task: Trace envelopes in `sendRequest`

- **Layer:** engine.
- **Files:** `UPDATE: src/cwmp-sim.ts` — in `sendRequest(xml)`.
- **Code:**
  ```ts
  async sendRequest(xml: string): Promise<null | string> {
    this._log.trace("→ ACS\n" + xml);
    const body = await this._httpClient.sendRequest(xml);
    this._log.trace("← ACS\n" + (body && body.length ? body : "(empty / 204)"));
    // …existing reboot / factory-reset / empty handling unchanged…
  }
  ```
- **Validation:** `node dist/main.js --log-level trace` (against a reachable ACS) prints Inform/response envelopes; `--log-level info` does not.

#### Task: Docs

- **Layer:** docs.
- **Files:** `UPDATE: README.md` (Configuration: `LOG_LEVEL`/`--log-level`; a "Logging" section: lib silent by default, CLI info, `trace` for envelopes, BYO logger via `options.log.logger`); `UPDATE: PENDING.md` (Idea #15 SOAP wire-log → done via logging subsystem).
- **Validation:** manual read.

## Risks & tradeoffs

- **Behavior change:** default CLI output drops from "everything" to `info` (verbose lines become `debug`). Intended; documented. Anyone relying on the old chatter uses `--log-level debug`.
- **Threading churn:** Phase 2 touches 12 files + 3 constructors — mechanical but broad. Mitigated by `NULL_LOGGER` defaults so partial migration never crashes and existing tests keep passing.
- **`requestWithDigest`** is a free function used outside a class (e.g. transfer tasks call it) — pass `this._device._log`; default `NULL_LOGGER` keeps it silent if omitted.
- **Custom logger** must implement all five methods; document that `trace` may be aliased to `debug` by simple loggers.

## Resume state

- **Done so far:** **Phase 1 ✅** — `src/logger.ts` created (`Logger`/`LogLevel`/`createLogger`/`NULL_LOGGER`); `src/types.ts` gained `CwmpLogOptions` + `log?` + `CwmpDeviceOptions.logger?`; `src/config/fields.ts` has the `log.level` field (`LOG_LEVEL`/`--log-level`, default `info`, `asLogLevel`); `CWMPSimulator._log` is built in the constructor (lib silent / CLI info / BYO logger). Tests: `test/logger.test.ts` (7) + `test/config.test.ts` (log assertions). Incidental cleanup: deleted the stale duplicate `src/config.ts` and repointed `test/config.test.ts` to `src/config/index.ts`. **74 tests pass, `npm run check` clean.** Verified end-to-end: lib default silent, custom logger injected, CLI `log.level=info`.
- **Phase 2 ✅** — logger threaded into `CWMPDevice` (`options.logger`), `CwmpHttp` (params `.logger` + passed into `requestWithDigest`), `CWMPConn` (3rd ctor arg); `CWMPSimulator` passes `this._log` to all three; `requestWithDigest` callers in `task-download`/`task-upload`/`diag-download`/`diag-upload` pass `logger`. All 108 `console.*` migrated per Decision 5 (lifecycle→info: connection/session/reboot/factory/`Received:`/listening/connection-request; not-supported→warn; failures→error/warn; rest→debug). **`rg console. src` → only `logger.ts`.** `npm run check` clean; **74 tests pass** (and test output is now quiet — devices built without a logger are silent). CLI verified: `info` shows lifecycle, `silent` nothing, `debug` adds debug lines.
- **Phase 3 ✅** — `CWMPSimulator.sendRequest` traces `→ ACS`/`← ACS` envelopes via `this._log.trace`; README gained a **Logging** section + `LOG_LEVEL` row + structure fix (`config/`, `logger.ts`); PENDING Idea #15 checked off. Verified: envelope tracing fires at `trace`.
- **Next action:** None — **shipped**. (Follow-on: `prefix` is wired in the logger but not yet used per-device; multi-device can set `log.prefix` to a device serial.)
- **Open questions:** None.
- **Watch out for:** lib-silent vs CLI-info hinges on `buildOptions` defaulting `log.level="info"` while `CWMPSimulator` defaults to silent when `options.log` is absent — keep that asymmetry. Don't touch `src/logger.ts`'s own sink. `main.ts` (the CLI bin, not `src/`) still uses `console.log` for its startup banner — intentional; out of scope.

## Final verification checklist

- [x] `npm run check` clean; `npm test` green (74, incl. `test/logger.test.ts`).
- [x] `rg "console\." src` returns only `src/logger.ts`.
- [x] `new CWMPSimulator({device,conn,acs})` (no `log`) produces **no** output; `{ log: { level: "trace" } }` is verbose.
- [x] CLI defaults to `info`; `--log-level trace` shows SOAP envelopes.
- [x] A custom `options.log.logger` receives the calls.
- [x] README + PENDING updated.
- [x] Status synced: this header, `00-enhancements.md`, `index.md`.
