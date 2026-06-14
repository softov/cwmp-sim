# PENDING — Known Limitations & Ideas

`cwmp-sim` is useful for ACS integration testing, but it is **not** a complete
Broadband Forum conformance implementation. This document tracks current gaps
(**Known limitations**) and forward-looking enhancements (**Ideas**).

## Known limitations

- [ ] **`ScheduleInform`** stores the requested schedule but does not start a timer for the future inform.
- [ ] **`ScheduleDownload`** adds a queued transfer entry but does not execute the scheduled download.
- [ ] **`CancelTransfer`** removes queued entries but does not abort an already-running HTTP request.
- [ ] **CSV import/export** is not fully implemented. `DEVICE_CSV` is accepted and `exportCSV()` is called on `SIGINT`, but the current export function is a placeholder.
- [ ] **Upload tasks** expect local files such as `./sample/firmware.bin`, `./sample/web-content.tar`, `./sample/vendor-config.xml`, and `./sample/vendor-log.txt`; these must exist for those upload file types to succeed.
- [ ] **FTP and TFTP transfers** are not implemented; transfer tasks use HTTP/HTTPS only.
- [ ] **HTTPS Connection Request mode** is present in the code path, but certificate/key handling is not implemented.
- [ ] **XML parser** is intentionally lightweight and does not support every XML feature, including CDATA.
- [x] **`Download`/`Upload` happy paths are now tested** ([test/transfers.test.ts](test/transfers.test.ts)) against a local `node:http` mock server: download success (FaultCode 0) and failure (404 → 9010), upload success (temp sample file + PUT 200) and missing-file failure (9010). Each asserts the queued `TransferComplete` message.

## Ideas

Forward-looking enhancements (items that are *current gaps* live under Known limitations).

### A. Scale & fleet simulation
- [ ] 1. **Multi-device mode** — spawn N simulated CPEs from one process, each with its own serial/OUI/MAC (`--count 100`). **(L, high-impact)**
- [ ] 2. **Serial/MAC offset + templating** — derive unique identities from a base + index. **(S)**
- [ ] 3. **Staggered boot / inform jitter** — randomized startup so N devices don't hammer the ACS at once. **(S)**
- [ ] 4. **CSV/JSON fleet definition** — one file describing many devices (paraam's `agent.csv` model). **(M)**

### B. Connection Request mechanisms (currently HTTP + Digest only)
- [ ] 5. **STUN-based connection requests** (TR-069 Annex G) — for CPEs behind NAT. **(M)**
- [ ] 6. **XMPP connection requests** (TR-069 Annex K). **(M)**

### C. Protocol depth
- [ ] 7. **Atomic `SetParameterValues`** — failures currently fault, but already-applied writes are not rolled back. **(M)**
- [ ] 8. **Active value-change notifications** — emit `4 VALUE CHANGE` informs when an active-notify param changes (attributes are stored but not acted on). **(M)**
- [ ] 9. **Round out `GetParameterAttributes` / AccessList** handling. **(S)**
- [ ] 10. **Fault injection** — make any RPC return a configured CWMP fault, or simulate offline/timeout/reboot-loop, to exercise ACS error handling. **(M, very useful)**

### D. Data model
- [ ] 11. **Bundled realistic device profiles** — ship vendor-flavored TR-181/TR-098 fixtures (`models/` + `sample/`). **(S–M)**
- [ ] 12. **TR-181 Device:2 coverage expansion** — WiFi.Radio, Hosts, Ethernet, DHCP, etc. **(L)**

### E. Modern protocols
- [ ] 13. **Bulk Data Collection (TR-069 Amendment 6)** — periodic JSON/CSV push of TR-181 data to an HTTP collector. **(M–L, differentiating)**
- [ ] 14. **USP / TR-369 agent mode** — the CWMP successor. **(XL)**

### F. Developer experience & observability
- [ ] 15. **SOAP wire-log / envelope dump** — flag to print every request/response (matches the README's debugging pitch). **(S)**
- [ ] 16. **Web dashboard / REST control API** — start/stop devices, trigger informs, set params at runtime. **(L)**
- [ ] 17. **Scriptable scenarios** — JSON/YAML script of "boot → wait → expect SPV → assert" (like AX INTEROP / CDRouter). **(L)**
- [ ] 18. **Library/SDK API** — stable exports so others embed the simulator ("convert to a lib" goal). **(M)**

### G. Quality / packaging
- [ ] 19. **Conformance checklist** — document which TR-069 Amendment 5 RPCs/behaviors are spec-conformant. **(S, docs)**
- [ ] 20. **Cross-platform diagnostics** — `diag-ping.ts` uses Windows `ping` syntax; add Linux/macOS parsing so it works in CI/containers. **(S, also a latent bug)**

## Status

Experimental — intended for ACS testing, protocol debugging, and development environments.
Behavior may not match every vendor CPE or every edge case from the full TR-069 specification.
