# PENDING — Known Limitations & Ideas

`cwmp-sim` is useful for ACS integration testing, but it is **not** a complete
Broadband Forum conformance implementation. This document tracks current gaps
(**Known limitations**) and forward-looking enhancements (**Ideas**).

## Known limitations

- [ ] **`ScheduleInform`** stores the requested schedule but does not start a timer for the future inform.
- [ ] **`ScheduleDownload`** adds a queued transfer entry but does not execute the scheduled download.
- [ ] **`CancelTransfer`** removes queued entries but does not abort an already-running HTTP request.
- [ ] **CSV/JSON _export_** (dump a live device's tree to a file) is not implemented. _Import_ now is: `--model <name|path.csv|path.json>` loads a device model; the old `DEVICE_CSV`/`exportCSV()` placeholder was removed.
- [ ] **Upload tasks** expect local files such as `./sample/firmware.bin`, `./sample/web-content.tar`, `./sample/vendor-config.xml`, and `./sample/vendor-log.txt`; these must exist for those upload file types to succeed.
- [ ] **FTP and TFTP transfers** are not implemented; transfer tasks use HTTP/HTTPS only.
- [ ] **HTTPS Connection Request mode** is present in the code path, but certificate/key handling is not implemented.
- [ ] **XML parser** is intentionally lightweight and does not support every XML feature, including CDATA.
- [x] **`Download`/`Upload` happy paths are now tested** ([test/transfers.test.ts](test/transfers.test.ts)) against a local `node:http` mock server: download success (FaultCode 0) and failure (404 → 9010), upload success (temp sample file + PUT 200) and missing-file failure (9010). Each asserts the queued `TransferComplete` message.

## Ideas

Forward-looking enhancements (items that are *current gaps* live under Known limitations).

### A. Scale & fleet simulation
- [x] 1. **Multi-device mode** — `--count N` runs N self-running CPEs in one process behind a single shared `CWMPConn`, path-routed by `/{hash}`. See `roadmap/plans/fleet/01-multi-device-runtime.md`. **(L, high-impact)**
- [x] 2. **Serial/MAC offset + templating** — identity fields support `{i}`/`{i:04}`/`{i+N}`/`{i:02x}`, resolved per-device from its index. See `roadmap/plans/enhancements/01-pre-fleet-enhancements-p3-serial-mac-templating.md`. **(S)**
- [x] 3. **Staggered boot / inform jitter** — `--boot-delay` spaces each device's boot so N devices don't hammer the ACS at once (part of the fleet runtime). **(S)**
- [x] 4. **Fleet definition** — mixed-type fleets via **grouped flags**: each `--model <name|default>` opens a device group, group-scoped flags bind to it, global flags apply fleet-wide. See `roadmap/plans/fleet/02-device-templates.md` (Phase 3). _(A single `config.json` source — describing the whole fleet in one file — is a deliberate future option, not done here.)_ **(M)**
- [x] 4b. **Per-device state persistence** — writable params (what the ACS sets) survive restarts. IO-free lib (`exportState`/`importState` + `device:save`/`device:load` events); binary file store (root `storage.ts`, `--storage-dir`, default `~/.cwmp-sim/devices/`), keyed by serial; saved on stop + after each session (dirty-gated). See `roadmap/plans/fleet/03-device-state.md`. **(M)**
- [x] 4c. **Dynamic fleet control + event bus** — `addGroup` returns a handle; `removeGroup`/`restartGroup` + per-device `removeDevice`/`rebootDevice` at runtime; `CWMPSimulator` is an EventEmitter (`device:add`/`remove`/`boot`/`session`/`inform`/`diagnostic`/`save`/`load`). The foundation for #16. See `roadmap/plans/fleet/04-dynamic-control.md`. **(M)**

### B. Connection Request mechanisms (currently HTTP + Digest only)
- [ ] 5. **STUN-based connection requests** (TR-069 Annex G) — for CPEs behind NAT. **(M)**
- [ ] 6. **XMPP connection requests** (TR-069 Annex K). **(M)**

### C. Protocol depth
- [ ] 7. **Atomic `SetParameterValues`** — failures currently fault, but already-applied writes are not rolled back. **(M)**
- [ ] 8. **Active value-change notifications** — emit `4 VALUE CHANGE` informs when an active-notify param changes (attributes are stored but not acted on). **(M)**
- [ ] 9. **Round out `GetParameterAttributes` / AccessList** handling. **(S)**
- [ ] 10. **Fault injection** — make any RPC return a configured CWMP fault, or simulate offline/timeout/reboot-loop, to exercise ACS error handling. **(M, very useful)**

### D. Data model
- [ ] 11. **Bundled realistic device profiles** — ship vendor-flavored TR-181/TR-098 fixtures (`models/` + `sample/`). _Partial:_ the loader + `models/generic-tr098.csv` / `generic-tr181.json` ship (fleet/02); vendor-flavored (ZTE/Huawei) dumps still to add. **(S–M)**
- [ ] 12. **TR-181 Device:2 coverage expansion** — WiFi.Radio, Hosts, Ethernet, DHCP, etc. **(L)**

### E. Modern protocols
- [ ] 13. **Bulk Data Collection (TR-069 Amendment 6)** — periodic JSON/CSV push of TR-181 data to an HTTP collector. **(M–L, differentiating)**
- [ ] 14. **USP / TR-369 agent mode** — the CWMP successor. **(XL)**

### F. Developer experience & observability
- [x] 15. **SOAP wire-log / envelope dump** — delivered via the logging subsystem: SOAP envelopes log at `trace` (`--log-level trace`). See `roadmap/plans/enhancements/02-logging-subsystem.md`.
- [x] 16. **Web dashboard / REST control API** — `--dashboard` serves a binary-side HTTP server (root `dashboard.ts`): REST control (add/remove/restart groups, reboot/remove/inform/set-param) + a hand-rolled RFC-6455 WebSocket live feed of the `device:*` bus + one self-contained HTML page (vanilla JS, **zero deps**). **+ Metrics:** per-device & global counters (per-RPC, failures, informs), last recv/sent RPC, pending + recent tasks, last-inform age; device summary panel, param search, searchable/clearable/counted log (`device:rpc` lines). See `roadmap/plans/dashboard/01-dashboard.md`, `02-metrics-observability.md`. **(L)**
- [ ] 17. **Scriptable scenarios** — JSON/YAML script of "boot → wait → expect SPV → assert" (like AX INTEROP / CDRouter). **(L)**
- [x] 18. **Library/SDK API** — `src/index.ts` exports `CWMPSimulator`/`CWMPDevice` + option types; `package.json` `main`/`types`/`exports` point at it; the device is self-running and importable. See `roadmap/plans/architecture/01-entry-lib-refactor.md`. **(M)**

### G. Quality / packaging
- [ ] 19. **Conformance checklist** — document which TR-069 Amendment 5 RPCs/behaviors are spec-conformant. **(S, docs)**
- [x] 20. **Cross-platform diagnostics** — ping + traceroute now detect `process.platform` and use the right command + output parser for win32 and posix (linux/darwin), via the unit-tested `src/diag-platform.ts`. (Also fixed the `diag-traceroute` missing-dot `DiagnosticsState` bug.) See `roadmap/plans/enhancements/01-pre-fleet-enhancements-p2-cross-platform-diagnostics.md`.

## Status

Experimental — intended for ACS testing, protocol debugging, and development environments.
Behavior may not match every vendor CPE or every edge case from the full TR-069 specification.
