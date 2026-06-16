import { test } from "node:test";
import assert from "node:assert/strict";

import cwmpModel from "../src/cwmp-defaults.ts";

test("merge combines shallow keys from both sides", () => {
  assert.deepEqual(cwmpModel.merge({ a: 1, b: 2 }, { b: 3, c: 4 }), { a: 1, b: 3, c: 4 });
});

test("merge recurses into nested plain objects", () => {
  const result = cwmpModel.merge({ x: { p: 1, q: 2 } }, { x: { q: 9 } });
  assert.deepEqual(result, { x: { p: 1, q: 9 } });
});

test("merge lets a null in the source overwrite the target", () => {
  const result = cwmpModel.merge({ a: { p: 1 } }, { a: null });
  assert.equal(result.a, null);
});

test("merge deep-clones target-only keys instead of sharing references", () => {
  const target = { a: { p: 1 } };
  const result = cwmpModel.merge(target, {});
  assert.deepEqual(result, { a: { p: 1 } });
  assert.notEqual(result.a, target.a);
});

test("toInternalModel maps value/type/writable to the internal shape", () => {
  const internal = cwmpModel.toInternalModel({
    Foo: { value: "1", type: "xsd:string" },
  });
  assert.deepEqual(internal.Foo, { _value: "1", _type: "xsd:string", _writable: true });
});

test("toInternalModel honors an explicit writable: false", () => {
  const internal = cwmpModel.toInternalModel({
    Baz: { value: "v", type: "xsd:string", writable: false },
  });
  assert.equal(internal.Baz._writable, false);
});

test("toInternalModel passes through already-internal entries", () => {
  const internal = cwmpModel.toInternalModel({
    Bar: { _value: "x", _type: "xsd:string", _writable: false },
  });
  assert.deepEqual(internal.Bar, { _value: "x", _type: "xsd:string", _writable: false });
});

test("default param fixtures expose the expected internal leaf shape", () => {
  const p = cwmpModel.ipPingDiagnosticsParams.DiagnosticsState;
  assert.equal(p._value, "None");
  assert.equal(p._writable, true);
});
