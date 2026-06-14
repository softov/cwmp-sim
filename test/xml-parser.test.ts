import { test } from "node:test";
import assert from "node:assert/strict";

import xmlParser from "../src/xml-parser.ts";

test("parseXml builds a nested tree with text content", () => {
  const root = xmlParser.parseXml("<Foo><Bar>baz</Bar></Foo>");
  assert.equal(root.children.length, 1);

  const foo = root.children[0];
  assert.equal(foo.name, "Foo");
  assert.equal(foo.children.length, 1);

  const bar = foo.children[0];
  assert.equal(bar.name, "Bar");
  assert.equal(bar.text, "baz");
});

test("parseXml splits namespace prefix and local name", () => {
  const root = xmlParser.parseXml("<soap:Body><x/></soap:Body>");
  const body = root.children[0];
  assert.equal(body.name, "soap:Body");
  assert.equal(body.namespace, "soap");
  assert.equal(body.localName, "Body");
});

test("parseXml ignores the XML declaration", () => {
  const root = xmlParser.parseXml('<?xml version="1.0"?>\n<a/>');
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].name, "a");
});

test("parseXml throws on an unmatched closing tag", () => {
  assert.throws(() => xmlParser.parseXml("<a></b>"), /Unmatched closing tag/);
});

test("decodeEntities resolves named and numeric entities", () => {
  assert.equal(xmlParser.decodeEntities("&lt;a&gt; &amp; &#65;"), "<a> & A");
});

test("encodeEntities escapes the five XML special characters", () => {
  assert.equal(xmlParser.encodeEntities('<a> & "x"'), "&lt;a&gt; &amp; &quot;x&quot;");
});

test("encode/decode entities round-trip", () => {
  const original = `tom & jerry <say> "hi" 'bye'`;
  assert.equal(xmlParser.decodeEntities(xmlParser.encodeEntities(original)), original);
});

test("parseAttrs returns name/value pairs", () => {
  const attrs = xmlParser.parseAttrs('foo="bar" count="2"');
  assert.equal(attrs.length, 2);
  assert.equal(attrs[0].name, "foo");
  assert.equal(attrs[0].value, "bar");
  assert.equal(attrs[1].name, "count");
  assert.equal(attrs[1].value, "2");
});

test("parseXmlDeclaration reads the encoding attributes", () => {
  const buf = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<a/>');
  const attrs = xmlParser.parseXmlDeclaration(buf);
  assert.ok(attrs);
  const version = attrs.find((a: any) => a.name === "version");
  assert.equal(version?.value, "1.0");
});
