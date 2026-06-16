import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv, toRows, rowsToTree } from "../src/template/csv.ts";
import { jsonToTree } from "../src/template/json.ts";
import { loadTemplate } from "../src/template/loader.ts";

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

// --- parseCsv (RFC 4180) ---

test("parseCsv splits simple rows", () => {
  const t = parseCsv("a,b,c\n1,2,3\n");
  assert.deepEqual(t, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv handles quoted commas, escaped quotes, and CRLF", () => {
  const t = parseCsv('Parameter,Value\r\n"a,b","say ""hi"""\r\n');
  assert.deepEqual(t, [["Parameter", "Value"], ["a,b", 'say "hi"']]);
});

test("parseCsv keeps newlines inside quoted fields", () => {
  const t = parseCsv('x\n"line1\nline2"\n');
  assert.deepEqual(t, [["x"], ["line1\nline2"]]);
});

test("parseCsv strips a leading BOM and needs no trailing newline", () => {
  const t = parseCsv(String.fromCharCode(0xfeff) + "a,b\n1,2");
  assert.deepEqual(t, [["a", "b"], ["1", "2"]]);
});

// --- toRows (header-keyed) ---

test("toRows keys cells by header name and skips blank lines", () => {
  const rows = toRows(parseCsv("Parameter,Value\n\nP,V\n"));
  assert.deepEqual(rows, [{ Parameter: "P", Value: "V" }]);
});

// --- rowsToTree ---

test("rowsToTree maps Object true→container and false→leaf", () => {
  const csv = [
    "Parameter,Object,Writable,Value,Value type",
    "Device,true,false,,",
    "Device.DeviceInfo,true,false,,",
    "Device.DeviceInfo.SerialNumber,false,false,ABC123,xsd:string",
    "Device.DeviceInfo.UpTime,false,true,42,xsd:unsignedInt",
  ].join("\n");
  const { root, tree } = rowsToTree(toRows(parseCsv(csv)));

  assert.equal(root, "Device");
  // container has no _value
  assert.equal(tree.Device.DeviceInfo._value, undefined);
  // leaf carries value/type/writable
  assert.deepEqual(tree.Device.DeviceInfo.SerialNumber, {
    _value: "ABC123",
    _type: "xsd:string",
    _writable: false,
  });
  assert.deepEqual(tree.Device.DeviceInfo.UpTime, {
    _value: "42",
    _type: "xsd:unsignedInt",
    _writable: true,
  });
});

test("rowsToTree reads a GenieACS-style 12-column dump by header name", () => {
  // Real dumps add timestamp / notification / access-list columns and virtual
  // DeviceID.* / Tags.* rows. Header-keying must ignore the extras; root inferred.
  const csv = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
    "DeviceID.SerialNumber,false,,false,,VIRT,xsd:string,,0,,,",
    "Tags.foo,false,,true,,1,xsd:boolean,,0,,,",
    "InternetGatewayDevice,true,,false,,,,,0,,,",
    "InternetGatewayDevice.DeviceInfo,true,,false,,,,,0,,,",
    'InternetGatewayDevice.DeviceInfo.OUI,false,,false,,"00E0FC",xsd:string,,0,,,',
  ].join("\n");
  const { root, tree } = rowsToTree(toRows(parseCsv(csv)));

  assert.equal(root, "InternetGatewayDevice");
  assert.equal(tree.InternetGatewayDevice.DeviceInfo.OUI._value, "00E0FC");
  // virtual rows outside the root are skipped
  assert.equal(tree.DeviceID, undefined);
  assert.equal(tree.Tags, undefined);
});

test("rowsToTree defaults a missing Value type to xsd:string", () => {
  const csv = ["Parameter,Object,Writable,Value,Value type", "Device.X,false,true,hi,"].join("\n");
  const { tree } = rowsToTree(toRows(parseCsv(csv)));
  assert.equal(tree.Device.X._type, "xsd:string");
});

// --- jsonToTree ---

test("jsonToTree converts plain values into CWMP leaves and infers types", () => {
  const { root, tree } = jsonToTree({
    Device: { DeviceInfo: { SerialNumber: "S1" }, WiFi: { Radio: { 1: { Channel: 6, Enable: true } } } },
  });
  assert.equal(root, "Device");
  assert.deepEqual(tree.Device.DeviceInfo.SerialNumber, {
    _value: "S1",
    _type: "xsd:string",
    _writable: true,
  });
  assert.equal(tree.Device.WiFi.Radio["1"].Channel._type, "xsd:int");
  assert.equal(tree.Device.WiFi.Radio["1"].Enable._type, "xsd:boolean");
});

// --- loadTemplate (shipped example files) ---

test("loadTemplate loads the shipped CSV template by name", async () => {
  const { root, tree } = await loadTemplate("generic-tr098", TEMPLATES_DIR);
  assert.equal(root, "InternetGatewayDevice");
  assert.equal(tree.InternetGatewayDevice.DeviceInfo.Manufacturer._value, "Generic");
  assert.equal(tree.InternetGatewayDevice.LANDevice["1"].WLANConfiguration["1"].SSID._writable, true);
});

test("loadTemplate loads the shipped JSON template by name", async () => {
  const { root, tree } = await loadTemplate("generic-tr181", TEMPLATES_DIR);
  assert.equal(root, "Device");
  assert.equal(tree.Device.DeviceInfo.ProductClass._value, "GenericTR181");
});

test("loadTemplate throws a helpful error for an unknown template", async () => {
  await assert.rejects(() => loadTemplate("does-not-exist", TEMPLATES_DIR), /Template not found/);
});
