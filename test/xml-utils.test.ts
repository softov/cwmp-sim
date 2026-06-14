import { test } from "node:test";
import assert from "node:assert/strict";

import xmlUtils from "../src/xml-utils.ts";

test("node() returns a self-closing tag when there is no value", () => {
  assert.equal(xmlUtils.node("Foo"), "<Foo/>");
});

test("node() wraps a value in an open/close tag", () => {
  assert.equal(xmlUtils.node("Foo", {}, "bar"), "<Foo>bar</Foo>");
});

test("node() serializes attributes", () => {
  assert.equal(xmlUtils.node("Foo", { a: "1", b: "2" }, "bar"), '<Foo a="1" b="2">bar</Foo>');
});

test("node() joins an array value", () => {
  assert.equal(xmlUtils.node("Foo", {}, ["a", "b", "c"]), "<Foo>abc</Foo>");
});

test("node() returns undefined for an empty key", () => {
  assert.equal(xmlUtils.node(""), undefined);
});

test("simpleFault() embeds the code and message", () => {
  const xml = xmlUtils.simpleFault(9001, "oops");
  assert.match(xml, /<FaultCode>9001<\/FaultCode>/);
  assert.match(xml, /<FaultString>oops<\/FaultString>/);
});

test("simpleFault() encodes special characters in the message", () => {
  const xml = xmlUtils.simpleFault(9002, "a & b");
  assert.match(xml, /a &amp; b/);
});

test("fault() includes the Client faultcode and CWMP detail", () => {
  const xml = xmlUtils.fault(9003, "Invalid arguments", "bad param");
  assert.match(xml, /<faultcode>Client<\/faultcode>/);
  assert.match(xml, /<faultstring>Invalid arguments<\/faultstring>/);
  assert.match(xml, /<cwmp:Fault>/);
  assert.match(xml, /<FaultCode>9003<\/FaultCode>/);
});
