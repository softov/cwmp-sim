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
