import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptions } from "../src/config/index.ts";

test("buildOptions reads env and applies CLI overrides", () => {
  const options = buildOptions(
    { ACS_URL: "http://acs/", DEVICE_SERIAL: "ENV1" },
    ["--serial", "CLI1", "--port", "9000"],
  );

  assert.equal(options.acs.url, "http://acs/");
  assert.equal(options.device.serialNumber, "CLI1");
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
  assert.equal(o.device.serialNumber, "SIM-{i}"); // raw — the device stamps its index
  assert.equal(o.device.mac, "AA:{i:02}");
  assert.equal(o.device.index, 7);
});

test("buildOptions parses fleet count and boot delay", () => {
  assert.equal(buildOptions({}, []).fleet?.count, 1);
  assert.equal(buildOptions({}, ["--count", "5"]).fleet?.count, 5);
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
