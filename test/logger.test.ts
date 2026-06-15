import { test } from "node:test";
import assert from "node:assert/strict";

import { createLogger, NULL_LOGGER, LOG_LEVELS } from "../src/logger.ts";

test("level filters which messages are emitted", () => {
  const seen: string[] = [];
  const log = createLogger({ level: "info", sink: (lvl) => seen.push(lvl) });
  log.error("x");
  log.warn("x");
  log.info("x");
  log.debug("x");
  log.trace("x");
  assert.deepEqual(seen, ["error", "warn", "info"]);
});

test("trace level emits everything", () => {
  const seen: string[] = [];
  const log = createLogger({ level: "trace", sink: (lvl) => seen.push(lvl) });
  log.error("x"); log.warn("x"); log.info("x"); log.debug("x"); log.trace("x");
  assert.deepEqual(seen, ["error", "warn", "info", "debug", "trace"]);
});

test("silent emits nothing", () => {
  let n = 0;
  const log = createLogger({ level: "silent", sink: () => n++ });
  log.error("x");
  log.trace("x");
  assert.equal(n, 0);
});

test("default (no level) is silent", () => {
  let n = 0;
  const log = createLogger({ sink: () => n++ });
  log.error("x");
  assert.equal(n, 0);
});

test("prefix is prepended to the emitted args", () => {
  let got: unknown[] = [];
  const log = createLogger({ level: "trace", prefix: "[SN1]", sink: (_lvl, args) => (got = args) });
  log.info("hello", 42);
  assert.deepEqual(got, ["[SN1]", "hello", 42]);
});

test("NULL_LOGGER is a no-op", () => {
  // Should not throw and should produce no output.
  NULL_LOGGER.error("x");
  NULL_LOGGER.trace("x");
  assert.ok(true);
});

test("LOG_LEVELS lists all levels in verbosity order", () => {
  assert.deepEqual(LOG_LEVELS, ["silent", "error", "warn", "info", "debug", "trace"]);
});
