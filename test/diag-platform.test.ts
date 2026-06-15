import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pingCommand,
  parsePingOutput,
  tracerouteCommand,
  parseTracerouteHops,
} from "../src/diag-platform.ts";

const WIN_PING = [
  "Pinging 8.8.8.8 with 32 bytes of data:",
  "Reply from 8.8.8.8: bytes=32 time=25ms TTL=118",
  "",
  "Ping statistics for 8.8.8.8:",
  "    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),",
  "Approximate round trip times in milli-seconds:",
  "    Minimum = 24ms, Maximum = 26ms, Average = 25ms",
].join("\n");

const LINUX_PING = [
  "PING 8.8.8.8 (8.8.8.8) 32(60) bytes of data.",
  "64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=24.3 ms",
  "",
  "--- 8.8.8.8 ping statistics ---",
  "4 packets transmitted, 4 received, 0% packet loss, time 3003ms",
  "rtt min/avg/max/mdev = 24.116/25.002/26.001/0.700 ms",
].join("\n");

const MAC_PING = [
  "PING 8.8.8.8 (8.8.8.8): 56 data bytes",
  "64 bytes from 8.8.8.8: icmp_seq=0 ttl=118 time=25.1 ms",
  "",
  "--- 8.8.8.8 ping statistics ---",
  "4 packets transmitted, 3 packets received, 25.0% packet loss",
  "round-trip min/avg/max/stddev = 24.0/25.0/26.0/0.8 ms",
].join("\n");

test("pingCommand differs by platform", () => {
  const o = { host: "h", repetitions: 4, timeout: 1000, dataBlockSize: 32 };
  assert.equal(pingCommand(o, "win32"), "ping -n 4 -w 1000 -l 32 h");
  assert.equal(pingCommand(o, "linux"), "ping -c 4 -s 32 -W 1 h");
  assert.equal(pingCommand(o, "darwin"), "ping -c 4 -s 32 h");
});

test("parsePingOutput (windows)", () => {
  const r = parsePingOutput(WIN_PING, "win32");
  assert.equal(r.successCount, 4);
  assert.equal(r.failureCount, 0);
  assert.equal(r.minTime, 24);
  assert.equal(r.maxTime, 26);
  assert.equal(r.avgTime, 25);
  assert.equal(r.host, "8.8.8.8");
});

test("parsePingOutput (linux)", () => {
  const r = parsePingOutput(LINUX_PING, "linux");
  assert.equal(r.successCount, 4);
  assert.equal(r.failureCount, 0);
  assert.equal(r.avgTime, 25);
});

test("parsePingOutput (macOS round-trip + loss)", () => {
  const r = parsePingOutput(MAC_PING, "darwin");
  assert.equal(r.successCount, 3);
  assert.equal(r.failureCount, 1);
  assert.equal(r.avgTime, 25);
});

test("tracerouteCommand differs by platform", () => {
  const o = { host: "h", maxHopCount: 15, timeout: 1000 };
  assert.equal(tracerouteCommand(o, "win32"), "tracert -h 15 -w 1000 -d h");
  assert.equal(tracerouteCommand(o, "linux"), "traceroute -n -m 15 -w 1 h");
});

test("parseTracerouteHops (linux)", () => {
  const out = [
    "traceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets",
    " 1  192.168.0.1  0.512 ms  0.480 ms  0.470 ms",
    " 2  10.0.0.1  8.1 ms  8.0 ms  7.9 ms",
    " 3  * * *",
  ].join("\n");
  const hops = parseTracerouteHops(out, "linux");
  assert.equal(hops.length, 2); // the "* * *" line has no IP and is skipped
  assert.equal(hops[0].ip, "192.168.0.1");
  assert.equal(hops[1].ip, "10.0.0.1");
  assert.deepEqual(hops[1].times, [8, 8, 8]);
});

test("parseTracerouteHops (windows)", () => {
  const out = [
    "Tracing route to 8.8.8.8 over a maximum of 30 hops",
    "  1     1 ms     1 ms     1 ms  192.168.0.1",
    "  2     8 ms     7 ms     8 ms  10.0.0.1",
  ].join("\n");
  const hops = parseTracerouteHops(out, "win32");
  assert.equal(hops.length, 2);
  assert.equal(hops[0].ip, "192.168.0.1");
  assert.deepEqual(hops[0].times, [1, 1, 1]);
});
