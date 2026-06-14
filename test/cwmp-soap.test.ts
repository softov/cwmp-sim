import { test } from "node:test";
import assert from "node:assert/strict";

import cwmpSoap from "../src/cwmp-soap.ts";
import xmlParser from "../src/xml-parser.ts";

test("createSoapDocument returns an empty string for an empty body", () => {
  assert.equal(cwmpSoap.createSoapDocument("ID-1", ""), "");
});

test("createSoapDocument wraps the body in a SOAP envelope with the request ID", () => {
  const doc = cwmpSoap.createSoapDocument("REQ-42", "<cwmp:Reboot/>");
  assert.ok(doc.startsWith("<?xml"));
  assert.match(doc, /<cwmp:ID soap-env:mustUnderstand="1">REQ-42<\/cwmp:ID>/);
  assert.match(doc, /<soap-env:Body><cwmp:Reboot\/><\/soap-env:Body>/);
});

test("getRequestIdAndBody round-trips an ID and body from a generated document", () => {
  const doc = cwmpSoap.createSoapDocument("REQ-42", "<cwmp:Reboot/>");
  const parsed = xmlParser.parseXml(doc);
  const [id, body] = cwmpSoap.getRequestIdAndBody(parsed);

  assert.equal(id, "REQ-42");
  assert.ok(body);
  assert.equal(body!.localName, "Body");
  assert.equal(body!.children[0].localName, "Reboot");
});

test("getRequestIdAndBody decodes entity-encoded IDs", () => {
  const doc = cwmpSoap.createSoapDocument("a&b", "<cwmp:Reboot/>");
  const [id] = cwmpSoap.getRequestIdAndBody(xmlParser.parseXml(doc));
  assert.equal(id, "a&b");
});

test("getRequestIdAndBody returns an empty result for null input", () => {
  const [id, body] = cwmpSoap.getRequestIdAndBody(null);
  assert.equal(id, "");
  assert.equal(body, null);
});

test("createFaultResponse produces a CWMP fault envelope", () => {
  const doc = cwmpSoap.createFaultResponse("ID-9", 9000, "Method not supported");
  assert.ok(doc.startsWith("<?xml"));
  assert.match(doc, /<cwmp:Fault>/);
  assert.match(doc, /<FaultCode>9000<\/FaultCode>/);
  assert.match(doc, /<FaultString>Method not supported<\/FaultString>/);
});
