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
