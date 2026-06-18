import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptions } from "../src/config/index.ts";

test("buildOptions reads env and applies CLI overrides", () => {
  const options = buildOptions(
    { ACS_URL: "http://acs/", DEVICE_SERIAL: "ENV1" },
    ["--serial", "CLI1", "--port", "9000"],
  );

  assert.equal(options.acs.url, "http://acs/");
  assert.equal(options.fleet?.groups?.[0].device.serialNumber, "CLI1");
  assert.equal(options.conn.port, 9000);
});

test("buildOptions defaults log.level to info and parses overrides", () => {
  assert.equal(buildOptions({}, [])?.log?.level, "info");
  assert.equal(buildOptions({}, ["--log-level", "trace"])?.log?.level, "trace");
  assert.equal(buildOptions({ LOG_LEVEL: "debug" }, [])?.log?.level, "debug");
});

test("buildOptions rejects an invalid log level", () => {
  assert.throws(() => buildOptions({}, ["--log-level", "loud"]), /Invalid log level/);
});

test("buildOptions keeps identity templates raw (resolved per-device at construction)", () => {
  const o = buildOptions({}, ["--serial", "SIM-{i}", "--mac", "AA:{i:02}", "--index", "7"]);
  const g = o.fleet?.groups?.[0];
  assert.equal(g?.device.serialNumber, "SIM-{i}"); // raw — the device stamps its index
  assert.equal(g?.device.mac, "AA:{i:02}");
  assert.equal(o.fleet?.index, 7); // base index is fleet-level now
});

test("buildOptions parses per-group count, fleet index, and boot delay", () => {
  assert.equal(buildOptions({}, []).fleet?.groups?.[0].count, 1);
  assert.equal(buildOptions({}, ["--count", "5"]).fleet?.groups?.[0].count, 5);
  assert.equal(buildOptions({ FLEET_BOOT_DELAY: "250" }, []).fleet?.bootDelay, 250);
});

test("buildOptions always emits at least one fleet group", () => {
  const o = buildOptions({}, []);
  assert.equal(o.fleet?.groups?.length, 1);
  assert.equal(o.fleet?.groups?.[0].count, 1);
});

test("buildOptions parses the storage dir: flag > env > default", () => {
  assert.equal(buildOptions({}, ["--storage-dir", "/a"]).storageDir, "/a");
  assert.equal(buildOptions({ STORAGE_DIR: "/b" }, []).storageDir, "/b");
  assert.equal(buildOptions({}, []).storageDir, "~/.cwmp-sim/devices");
});

test("buildOptions parses the dashboard flags", () => {
  assert.equal(buildOptions({}, []).dashboard, false);
  assert.equal(buildOptions({}, ["--dashboard"]).dashboard, true);
  assert.equal(buildOptions({}, ["--dashboard-port", "9001"]).dashboardPort, 9001);
  assert.equal(buildOptions({}, []).dashboardPort, 3000);
  assert.equal(buildOptions({}, []).dashboardHost, "127.0.0.1");
});

test("grouped flags bind group-scoped flags to their --model; globals stay global", () => {
  const o = buildOptions({}, [
    "--port", "9000",
    "--model", "huawei", "--count", "5",
    "--model", "zte", "--count", "10",
  ]);
  // global flag is fleet-wide regardless of position
  assert.equal(o.conn.port, 9000);
  // two groups, each with its own template + count
  assert.equal(o.fleet?.groups?.length, 2);
  assert.equal(o.fleet?.groups?.[0].device.modelName, "huawei");
  assert.equal(o.fleet?.groups?.[0].count, 5);
  assert.equal(o.fleet?.groups?.[1].device.modelName, "zte");
  assert.equal(o.fleet?.groups?.[1].count, 10);
});

test("a group-scoped flag before the first --model seeds the base for every group", () => {
  const o = buildOptions({}, [
    "--serial", "BASE-{i}",
    "--model", "huawei", "--count", "1",
    "--model", "zte", "--serial", "ZTE-{i}", "--count", "1",
  ]);
  // group 1 inherits the base serial pattern; group 2 overrides it
  assert.equal(o.fleet?.groups?.[0].device.serialNumber, "BASE-{i}");
  assert.equal(o.fleet?.groups?.[1].device.serialNumber, "ZTE-{i}");
});

test("--interval is seconds → milliseconds on the group device", () => {
  assert.equal(buildOptions({}, ["--interval", "300"]).fleet?.groups?.[0].device.interval, 300000);
  // default (unset) is 0 → the device keeps its built-in 300000ms
  assert.equal(buildOptions({}, []).fleet?.groups?.[0].device.interval, 0);
  assert.equal(buildOptions({ DEVICE_INTERVAL: "5" }, []).fleet?.groups?.[0].device.interval, 5000);
});

test("--off inform / --off cr is repeatable, case-insensitive → noInform/noCr", () => {
  const off = buildOptions({}, ["--off", "inform", "--off", "CR"]).fleet?.groups?.[0].device;
  assert.equal(off?.noInform, true);
  assert.equal(off?.noCr, true);
  const none = buildOptions({}, []).fleet?.groups?.[0].device;
  assert.equal(none?.noInform, false);
  assert.equal(none?.noCr, false);
});

test("--off binds per group; a base --off is inherited by every group", () => {
  const o = buildOptions({}, [
    "--off", "inform",
    "--model", "huawei",
    "--model", "zte", "--off", "cr",
  ]);
  // group 1 inherits the base --off inform
  assert.equal(o.fleet?.groups?.[0].device.noInform, true);
  assert.equal(o.fleet?.groups?.[0].device.noCr, false);
  // group 2 inherits inform AND adds its own cr
  assert.equal(o.fleet?.groups?.[1].device.noInform, true);
  assert.equal(o.fleet?.groups?.[1].device.noCr, true);
});
