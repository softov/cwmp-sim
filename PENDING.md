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
- [ ] **`SetParameterValues`** currently returns status `0` even if one or more parameter writes fail.
- [ ] **XML parser** is intentionally lightweight and does not support every XML feature, including CDATA.
- [ ] **`npm test`** (`node --test`) is a placeholder; the scripts under `test/` are not wired to run.

## Roadmap ideas

- [ ] Real CSV import/export (the JSON path is configurable; CSV export is still a placeholder).
- [ ] Real `ScheduleInform` / `ScheduleDownload` timers.
- [ ] Proper fault status propagation for partial `SetParameterValues` failures.
- [ ] TLS support for HTTPS Connection Requests (cert/key configuration).
- [ ] Wire `test/` scripts into `npm test`.
- [ ] Library API surface for the "convert to a lib" goal (stable public exports + types).

## Status

Experimental — intended for ACS testing, protocol debugging, and development
environments. Behavior may not match every vendor CPE or every edge case from the
full TR-069 specification.
