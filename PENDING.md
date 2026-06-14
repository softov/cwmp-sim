# PENDING — Known Limitations & Roadmap

`cwmp-sim` is useful for ACS integration testing, but it is **not** a complete
Broadband Forum conformance implementation. This document tracks known gaps and
planned work. Items are unchecked until implemented.

## Known limitations

- [ ] **`ScheduleInform`** stores the requested schedule but does not start a timer for the future inform.
- [ ] **`ScheduleDownload`** adds a queued transfer entry but does not execute the scheduled download.
- [ ] **`CancelTransfer`** removes queued entries but does not abort an already-running HTTP request.
- [ ] **CSV import/export** is not fully implemented. `DEVICE_CSV` is accepted and `exportCSV()` is called on `SIGINT`, but the current export function is a placeholder.
- [ ] **Upload tasks** expect local files such as `./sample/firmware.bin`, `./sample/web-content.tar`, `./sample/vendor-config.xml`, and `./sample/vendor-log.txt`; these must exist for those upload file types to succeed.
- [ ] **FTP and TFTP transfers** are not implemented; transfer tasks use HTTP/HTTPS only.
- [ ] **HTTPS Connection Request mode** is present in the code path, but certificate/key handling is not implemented.
- [x] **`SetParameterValues`** now responds with a CWMP fault (9008) when any write fails, instead of falsely returning status `0`. (Writes are still applied individually, not atomically — see roadmap.)
- [ ] **XML parser** is intentionally lightweight and does not support every XML feature, including CDATA.
- [x] **`npm test`** now runs the unit suite (`test/**/*.test.ts`) covering the pure modules (XML parser/utils, SOAP, model helpers), the device data model (get/set, read-only enforcement, AddObject/DeleteObject, listeners), and the RPC handlers (`cwmp-methods.ts`). The legacy `test/test-*` scratch scripts are intentionally excluded from the glob.
- [ ] **`Download`/`Upload` happy paths are untested.** On success they create a `TaskDownload`/`TaskUpload` that performs real HTTP I/O; only the validation/fault branches are unit-tested. Covering the success path needs a mock HTTP server.

## Roadmap ideas

- [ ] Real CSV import/export (the JSON path is configurable; CSV export is still a placeholder).
- [ ] Real `ScheduleInform` / `ScheduleDownload` timers.
- [ ] Atomic `SetParameterValues` (currently failures fault, but already-applied writes are not rolled back).
- [ ] Mock-HTTP-server tests for the `Download`/`Upload` success paths.
- [ ] TLS support for HTTPS Connection Requests (cert/key configuration).
- [ ] Wire `test/` scripts into `npm test`.
- [ ] Library API surface for the "convert to a lib" goal (stable public exports + types).

## Status

Experimental — intended for ACS testing, protocol debugging, and development
environments. Behavior may not match every vendor CPE or every edge case from the
full TR-069 specification.
