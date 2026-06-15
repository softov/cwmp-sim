"use strict";

/**
 * Platform-aware command building + output parsing for the `ping` and
 * `traceroute`/`tracert` diagnostics. Parsers are pure so they can be unit-tested
 * against captured Windows/Linux/macOS output without running the real commands.
 */
export type Platform = NodeJS.Platform;

const isWin = (p: Platform) => p === "win32";

export type PingOptions = {
  host: string;
  repetitions: number;
  timeout: number; // milliseconds
  dataBlockSize: number;
};

export type PingResult = {
  host: string;
  successCount: number;
  failureCount: number;
  minTime: number;
  maxTime: number;
  avgTime: number;
};

export function pingCommand(o: PingOptions, platform: Platform = process.platform): string {
  if (isWin(platform)) {
    return `ping -n ${o.repetitions} -w ${o.timeout} -l ${o.dataBlockSize} ${o.host}`;
  }
  const wsec = Math.max(1, Math.round(o.timeout / 1000));
  // Linux supports a per-probe `-W <seconds>` timeout; macOS (darwin) does not.
  const deadline = platform === "linux" ? ` -W ${wsec}` : "";
  return `ping -c ${o.repetitions} -s ${o.dataBlockSize}${deadline} ${o.host}`;
}

export function parsePingOutput(stdout: string, platform: Platform = process.platform): PingResult {
  const r: PingResult = { host: "", successCount: 0, failureCount: 0, minTime: 0, maxTime: 0, avgTime: 0 };

  const ip = stdout.match(/\(?(\d{1,3}(?:\.\d{1,3}){3})\)?/);
  if (ip) r.host = ip[1];

  if (isWin(platform)) {
    const pk = stdout.match(/Sent = (\d+), Received = (\d+), Lost = (\d+)/);
    if (pk) { r.successCount = +pk[2]; r.failureCount = +pk[3]; }
    const t = stdout.match(/Minimum = (\d+)ms, Maximum = (\d+)ms, Average = (\d+)ms/);
    if (t) { r.minTime = +t[1]; r.maxTime = +t[2]; r.avgTime = +t[3]; }
  } else {
    const pk = stdout.match(/(\d+) packets transmitted, (\d+)(?: packets)? received/);
    if (pk) { r.successCount = +pk[2]; r.failureCount = Math.max(0, +pk[1] - +pk[2]); }
    // Linux: "rtt min/avg/max/mdev = …" ; macOS: "round-trip min/avg/max/stddev = …"
    const t = stdout.match(/(?:rtt|round-trip) min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)/);
    if (t) { r.minTime = Math.round(+t[1]); r.avgTime = Math.round(+t[2]); r.maxTime = Math.round(+t[3]); }
  }

  return r;
}

export type TracerouteOptions = {
  host: string;
  maxHopCount: number;
  timeout: number; // milliseconds
};

export type TracerouteHop = { hop: number; ip: string; times: number[] };

export function tracerouteCommand(o: TracerouteOptions, platform: Platform = process.platform): string {
  if (isWin(platform)) {
    return `tracert -h ${o.maxHopCount} -w ${o.timeout} -d ${o.host}`;
  }
  const wsec = Math.max(1, Math.round(o.timeout / 1000));
  return `traceroute -n -m ${o.maxHopCount} -w ${wsec} ${o.host}`;
}

export function parseTracerouteHops(stdout: string, platform: Platform = process.platform): TracerouteHop[] {
  const hops: TracerouteHop[] = [];
  const toMs = (t: string) => (!t || t === "*" ? 0 : t.includes("<1") ? 0 : Math.round(parseFloat(t)));

  for (let line of stdout.split("\n")) {
    line = line.trim();
    if (isWin(platform)) {
      // "  1     1 ms     1 ms     1 ms  192.168.0.1"
      const m = line.match(/^(\d+)\s+((?:<1|\d+)\s*ms|\*)\s+((?:<1|\d+)\s*ms|\*)\s+((?:<1|\d+)\s*ms|\*)\s+(\S+)/);
      if (m) hops.push({ hop: +m[1], ip: m[5], times: [toMs(m[2]), toMs(m[3]), toMs(m[4])] });
    } else {
      // "1  192.168.0.1  0.512 ms  0.480 ms  0.470 ms"  (traceroute -n)
      const m = line.match(/^(\d+)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(.*)$/);
      if (m) {
        const times = [...m[3].matchAll(/([\d.]+)\s*ms/g)].map((x) => Math.round(+x[1]));
        hops.push({ hop: +m[1], ip: m[2], times });
      }
    }
  }

  return hops;
}
