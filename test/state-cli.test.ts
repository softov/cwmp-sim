import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { readState, writeState, resolveStorageDir } from "../storage.ts";
import type { SavedState } from "../src/types.ts";

function tmp() {
  return mkdtempSync(join(tmpdir(), "cwmp-state-"));
}

test("writeState/readState round-trip a device's state", () => {
  const dir = tmp();
  const state: SavedState = { params: { "Device.X": { value: "1", type: "xsd:string" } } };
  writeState(dir, "SN-1", state);
  assert.deepEqual(readState(dir, "SN-1"), state);
});

test("readState returns undefined for a missing device", () => {
  assert.equal(readState(tmp(), "nope"), undefined);
});

test("writeState is atomic — no .tmp left behind, one json file", () => {
  const dir = tmp();
  writeState(dir, "SN-2", { params: {} });
  assert.deepEqual(readdirSync(dir), ["SN-2.json"]);
});

test("writeState sanitizes an unsafe serial and keeps the file inside the dir", () => {
  const dir = tmp();
  writeState(dir, "../evil", { params: {} });
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /\.json$/);
  assert.ok(!files[0].includes("/") && !files[0].includes("\\"));
});

test("resolveStorageDir expands ~, passes through absolute paths, and defaults", () => {
  assert.equal(resolveStorageDir("/tmp/x"), "/tmp/x");
  assert.equal(resolveStorageDir("~/foo"), join(homedir(), "foo"));
  assert.equal(resolveStorageDir(), join(homedir(), ".cwmp-sim", "devices")); // default
});
