import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTemplate } from "../src/config/template.ts";

test("applyTemplate substitutes the index token", () => {
  assert.equal(applyTemplate("SIM-{i}", 7), "SIM-7");
});

test("applyTemplate zero-pads with {i:NN}", () => {
  assert.equal(applyTemplate("SIM-{i:04}", 7), "SIM-0007");
});

test("applyTemplate applies an offset with {i+NN}", () => {
  assert.equal(applyTemplate("{i+100}", 5), "105");
});

test("applyTemplate combines offset and padding", () => {
  assert.equal(applyTemplate("dev-{i+10:03}", 5), "dev-015");
});

test("applyTemplate replaces multiple tokens", () => {
  assert.equal(applyTemplate("{i}-{i+1}", 4), "4-5");
});

test("applyTemplate leaves plain strings untouched", () => {
  assert.equal(applyTemplate("no-change", 9), "no-change");
  assert.equal(applyTemplate("00E0FC", 9), "00E0FC");
});

test("applyTemplate formats hex with {i:x} / {i:02x} / {i:02X}", () => {
  assert.equal(applyTemplate("{i:x}", 16), "10");
  assert.equal(applyTemplate("{i:02x}", 1), "01");
  assert.equal(applyTemplate("{i:02x}", 255), "ff");
  assert.equal(applyTemplate("{i:02X}", 255), "FF");
});

test("applyTemplate builds a MAC from the last byte", () => {
  assert.equal(applyTemplate("00:E0:FC:00:00:{i:02x}", 1), "00:E0:FC:00:00:01");
  assert.equal(applyTemplate("00:E0:FC:00:00:{i:02x}", 42), "00:E0:FC:00:00:2a");
});
