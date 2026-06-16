import { test } from "node:test";
import assert from "node:assert/strict";

import CwmpParams from "../src/cwmp-params.ts";

function makeTree() {
  return {
    Device: {
      _writable: false,
      Info: {
        _writable: false,
        Name: { _value: "x", _type: "xsd:string", _writable: true },
        Serial: { _value: "S1", _type: "xsd:string", _writable: false },
      },
    },
  };
}

test("get / getValue / findNode read the tree", () => {
  const p = new CwmpParams(makeTree());
  assert.equal(p.getValue("Device.Info.Name"), "x");
  assert.equal(p.get("Device.Info"), null);          // container, not a leaf
  assert.ok(p.findNode("Device.Info"));
  assert.equal(p.findNode("Device.Nope"), null);
  assert.equal(p.getValue("Device.Nope"), "");
});

test("set mutates the leaf and reports via onChange", () => {
  const seen: unknown[][] = [];
  const p = new CwmpParams(makeTree(), (e, path, d) => seen.push([e, path, d]));
  assert.equal(p.set("Device.Info.Name", "y"), true);
  assert.equal(p.getValue("Device.Info.Name"), "y");
  assert.deepEqual(seen, [["set", "Device.Info.Name", "y"]]);
});

test("set refuses a read-only leaf unless forced", () => {
  const p = new CwmpParams(makeTree());
  assert.equal(p.set("Device.Info.Serial", "S2"), false);
  assert.equal(p.getValue("Device.Info.Serial"), "S1");
  assert.equal(p.set("Device.Info.Serial", "S2", true), true);
  assert.equal(p.getValue("Device.Info.Serial"), "S2");
});

test("getParameterNames and getLeaves enumerate children", () => {
  const p = new CwmpParams(makeTree());
  const names = p.getParameterNames("Device.Info", true);
  assert.ok(names.find((n: any) => n.name === "Device.Info.Name"));
  const leaves = p.getLeaves("Device.Info");
  assert.equal(leaves.length, 2);
  assert.ok(leaves.find((l) => l.name === "Device.Info.Serial" && l.value === "S1"));
});

test("default onChange is a no-op (no throw without a handler)", () => {
  const p = new CwmpParams(makeTree());
  assert.equal(p.set("Device.Info.Name", "z"), true);
  assert.equal(p.getValue("Device.Info.Name"), "z");
});
