<!--
Domain: enhancements
Status: 🟢 Shipped
Priority: Medium
Created: 2026-06-15
Revalidated: 2026-06-15
Dependencies: ./01-pre-fleet-enhancements.md (parent)
Reference: ./00-enhancements.md
-->

# ENHANCEMENTS-01·P2 — Cross-platform diagnostics

_Status: 🟢 Shipped · Priority: Medium · Created: 2026-06-15_

Child of [01-pre-fleet-enhancements](./01-pre-fleet-enhancements.md). See the parent for full
Reconnaissance. Ships on its own; fully isolated to the diagnostics modules.

## Goal

Make the IP Ping and TraceRoute diagnostics run on Linux and macOS, not just Windows. Today both shell
out to Windows-only commands (`ping -n/-w/-l`, `tracert -h/-w/-d`) and parse Windows output, so on a
Linux CI runner or container the diagnostics produce garbage/empty results. Extract command-building
and output-parsing into a small platform-aware, unit-testable module.

## Decisions locked in (relevant subset)

| # | Decision | Source |
|---|----------|--------|
| 1 | Cover **ping + traceroute** for **win32** and **posix (linux/darwin)**; unknown platform → posix. | Parent D2, D7. |
| 2 | Extract command + parser into `src/diag-platform.ts` so parsers are unit-tested with captured fixtures (no `exec`). | Parent D2. |
| 3 | Fix the incidental `` `${path}DiagnosticsState` `` (missing dot) bug in `diag-traceroute.ts:87` while here. | Parent recon. |

## Platform reference (verified command shapes)

| | Windows (win32) | posix (linux/darwin) |
|---|---|---|
| ping | `ping -n <count> -w <ms> -l <size> <host>` | `ping -c <count> -s <size> <host>` (linux adds `-W <sec>` deadline; omit on darwin) |
| ping summary | `Packets: Sent = a, Received = b, Lost = c` ; `Minimum = a ms, Maximum = b ms, Average = c ms` | `a packets transmitted, b received, c% packet loss` ; `rtt min/avg/max/mdev = w/x/y/z ms` (linux) or `round-trip min/avg/max/stddev = …` (darwin) |
| traceroute | `tracert -h <max> -w <ms> -d <host>` | `traceroute -n -m <max> -w <sec> <host>` |

## Tasks

#### Task: Create the platform helper

- **Layer:** diagnostics (shared).
- **Files:** `CREATE: src/diag-platform.ts`.
- **Reason:** One place that knows per-OS command syntax and output formats; pure parsers are testable.
- **Code:**
  ```ts
  export type Platform = NodeJS.Platform;
  const isWin = (p: Platform) => p === "win32";

  export function pingCommand(o: { host: string; repetitions: number; timeout: number; dataBlockSize: number }, platform: Platform = process.platform): string {
    if (isWin(platform)) return `ping -n ${o.repetitions} -w ${o.timeout} -l ${o.dataBlockSize} ${o.host}`;
    const wsec = Math.max(1, Math.round(o.timeout / 1000));
    const deadline = platform === "linux" ? ` -W ${wsec}` : "";
    return `ping -c ${o.repetitions} -s ${o.dataBlockSize}${deadline} ${o.host}`;
  }

  export function parsePingOutput(stdout: string, platform: Platform = process.platform) {
    const r = { successCount: 0, failureCount: 0, minTime: 0, maxTime: 0, avgTime: 0, host: "" };
    const ipm = stdout.match(/\(?(\d{1,3}(?:\.\d{1,3}){3})\)?/);
    if (ipm) r.host = ipm[1];
    if (isWin(platform)) {
      const pk = stdout.match(/Sent = (\d+), Received = (\d+), Lost = (\d+)/);
      if (pk) { r.successCount = +pk[2]; r.failureCount = +pk[3]; }
      const t = stdout.match(/Minimum = (\d+)ms, Maximum = (\d+)ms, Average = (\d+)ms/);
      if (t) { r.minTime = +t[1]; r.maxTime = +t[2]; r.avgTime = +t[3]; }
    } else {
      const pk = stdout.match(/(\d+) packets transmitted, (\d+) (?:packets )?received/);
      if (pk) { r.successCount = +pk[2]; r.failureCount = Math.max(0, +pk[1] - +pk[2]); }
      const t = stdout.match(/(?:rtt|round-trip) min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)/);
      if (t) { r.minTime = Math.round(+t[1]); r.avgTime = Math.round(+t[2]); r.maxTime = Math.round(+t[3]); }
    }
    return r;
  }

  export function tracerouteCommand(o: { host: string; maxHopCount: number; timeout: number }, platform: Platform = process.platform): string {
    if (isWin(platform)) return `tracert -h ${o.maxHopCount} -w ${o.timeout} -d ${o.host}`;
    const wsec = Math.max(1, Math.round(o.timeout / 1000));
    return `traceroute -n -m ${o.maxHopCount} -w ${wsec} ${o.host}`;
  }

  export function parseTracerouteHops(stdout: string, platform: Platform = process.platform): Array<{ hop: number; ip: string; times: number[] }> {
    const hops: Array<{ hop: number; ip: string; times: number[] }> = [];
    for (let line of stdout.split("\n")) {
      line = line.trim();
      const win = line.match(/^(\d+)\s+((?:<1|\d+)\s*ms|\*)\s+((?:<1|\d+)\s*ms|\*)\s+((?:<1|\d+)\s*ms|\*)\s+(\S+)/);
      const nix = line.match(/^(\d+)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(.*)$/);
      const toMs = (t: string) => (t === "*" || t === "" ? 0 : t.includes("<1") ? 0 : parseFloat(t));
      if (isWin(platform) && win) {
        hops.push({ hop: +win[1], ip: win[5], times: [toMs(win[2]), toMs(win[3]), toMs(win[4])].map(Math.round) });
      } else if (!isWin(platform) && nix) {
        const times = [...nix[3].matchAll(/([\d.]+)\s*ms/g)].map(m => Math.round(+m[1]));
        hops.push({ hop: +nix[1], ip: nix[2], times });
      }
    }
    return hops;
  }
  ```
- **Validation:** unit tests below.

#### Task: Use the helper in `diag-ping.ts`

- **Layer:** diagnostics.
- **Files:** `UPDATE: src/diag-ping.ts` — `run()` (lines ~95-130): replace the inline Windows `cmd` and the Windows-only `stdout.match(...)` blocks with `pingCommand(...)` + `parsePingOutput(stdout)`; map the result fields into `this._result`.
- **Reason:** Portability + testability; behavior preserved on Windows.
- **Integration points:** keep the existing `exec(cmd, …)` + `this.finish()` flow; only the command string and the parsing change.
- **Validation:** `npx tsx examples/test-diag.ts` on the host OS yields non-zero `SuccessCount`/`AverageResponseTime`.

#### Task: Use the helper in `diag-traceroute.ts` + fix the dot bug

- **Layer:** diagnostics.
- **Files:** `UPDATE: src/diag-traceroute.ts` — `run()` (lines ~81-129): use `tracerouteCommand(...)` + `parseTracerouteHops(stdout)` to drive the existing `this._device.set(\`${hopPath}.…\`)` writes; **fix line 87** `` `${path}DiagnosticsState` `` → `` `${path}.DiagnosticsState` ``.
- **Reason:** Portability + correctness.
- **Validation:** traceroute on host OS populates `RouteHops.*` and `RouteHopsNumberOfEntries`.

#### Task: Unit-test the parsers with fixtures

- **Layer:** tests.
- **Files:** `CREATE: test/diag-platform.test.ts`.
- **Reason:** Lock parsing for both OS formats without running `ping`/`traceroute` (deterministic, CI-safe).
- **Code:**
  ```ts
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { parsePingOutput, parseTracerouteHops, pingCommand } from "../src/diag-platform.ts";

  const WIN_PING = `Pinging 8.8.8.8 with 32 bytes of data:\nReply from 8.8.8.8: bytes=32 time=25ms TTL=118\n\nPing statistics for 8.8.8.8:\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),\nApproximate round trip times in milli-seconds:\n    Minimum = 24ms, Maximum = 26ms, Average = 25ms`;
  const NIX_PING = `PING 8.8.8.8 (8.8.8.8) 32(60) bytes of data.\n64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=24.3 ms\n\n--- 8.8.8.8 ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss, time 3003ms\nrtt min/avg/max/mdev = 24.116/25.002/26.001/0.700 ms`;

  test("parsePingOutput (windows)", () => {
    const r = parsePingOutput(WIN_PING, "win32");
    assert.equal(r.successCount, 4); assert.equal(r.failureCount, 0); assert.equal(r.avgTime, 25);
  });
  test("parsePingOutput (linux)", () => {
    const r = parsePingOutput(NIX_PING, "linux");
    assert.equal(r.successCount, 4); assert.equal(r.failureCount, 0); assert.equal(r.avgTime, 25);
  });
  test("pingCommand differs by platform", () => {
    assert.match(pingCommand({ host: "h", repetitions: 4, timeout: 1000, dataBlockSize: 32 }, "win32"), /ping -n 4 -w 1000 -l 32 h/);
    assert.match(pingCommand({ host: "h", repetitions: 4, timeout: 1000, dataBlockSize: 32 }, "linux"), /ping -c 4 -s 32 -W 1 h/);
  });
  test("parseTracerouteHops (linux)", () => {
    const hops = parseTracerouteHops("1  192.168.0.1  0.512 ms  0.480 ms  0.470 ms\n2  10.0.0.1  8.1 ms  8.0 ms  7.9 ms", "linux");
    assert.equal(hops.length, 2); assert.equal(hops[1].ip, "10.0.0.1"); assert.equal(hops[0].times.length, 3);
  });
  ```
- **Validation:** `npm test` green.

#### Task: Docs + PENDING

- **Layer:** docs.
- **Files:** `UPDATE: README.md` (Diagnostics: note cross-platform support); `UPDATE: PENDING.md` (check off Idea #20 / cross-platform diagnostics).
- **Validation:** manual read.

## Risks & tradeoffs

- **macOS ping flags:** darwin's `ping` lacks a clean per-probe `-W` seconds flag equivalent to linux; the command omits the deadline on darwin and relies on `-c` count. Acceptable for a simulator.
- **`traceroute` not installed** on minimal Linux images: `exec` errors → the existing `.catch`/empty-hops path marks completion with zero hops. Documented; could add `tracepath` fallback later.
- **Locale-translated output** (non-English Windows) would break the regex — pre-existing limitation, unchanged.

## Resume state

- **Done so far:** **Shipped ✅** — `src/diag-platform.ts` created (`pingCommand`/`parsePingOutput`/`tracerouteCommand`/`parseTracerouteHops`, platform-branched win32/posix); `diag-ping.ts` + `diag-traceroute.ts` `run()` now use the helpers; the `diag-traceroute` `${path}DiagnosticsState`→`${path}.DiagnosticsState` dot bug is fixed. `test/diag-platform.test.ts` added (7 tests, windows/linux/macOS fixtures). README Diagnostics note + PENDING #20 checked. **81 tests pass, `npm run check` clean.** Verified on the Windows host: IPPing → `Complete`, `SuccessCount` non-zero.
- **Next action:** None — shipped. (Sibling P3 still pending; parent stays 🟡.)
- **Open questions:** None.
- **Watch out for:** macOS `ping` omits the per-probe `-W` flag (handled); minimal Linux images may lack `traceroute` (errors → zero hops, existing path).

## Final verification checklist

- [x] `npm run check` clean; `npm test` green (81, incl. `diag-platform.test.ts`).
- [x] Verified on the host OS: IPPing completes with non-zero stats (`SuccessCount` 2).
- [x] `diag-traceroute` missing-dot `DiagnosticsState` bug fixed.
- [x] README + PENDING updated (Idea #20 checked).
- [x] Status synced: this header, `00-enhancements.md`, parent phase map, `index.md`.
