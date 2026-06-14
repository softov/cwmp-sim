import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";

import methods from "../src/cwmp-methods.ts";
import CWMPDevice from "../src/cwmp-device.ts";

// A tiny local server: GET/PUT -> 200, /fail -> 404. It drains request bodies so
// uploads (PUT) complete cleanly.
let server: Server;
let base = "";

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/fail") {
      res.statusCode = 404;
      res.end("nope");
      return;
    }
    req.on("data", () => {});
    req.on("end", () => {
      res.statusCode = 200;
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function makeDevice() {
  return new CWMPDevice({ rootName: "Device", serialNumber: "SN-TEST" });
}

// Drives a transfer handler and resolves once the task completes (the device
// fires `sessionInform` after queuing the TransferComplete message).
function runTransfer(device: CWMPDevice, trigger: () => string): Promise<{ event: string; xml: string | null }> {
  return new Promise((resolve) => {
    device.addListener("sessionInform", (event: string) => {
      const msg = device.getNextMessage();
      resolve({ event, xml: msg ? msg() : null });
    });
    trigger();
  });
}

// Build the RPC request node by parsing a SOAP fragment.
import xmlParser from "../src/xml-parser.ts";
function req(xml: string) {
  return xmlParser.parseXml(xml).children[0] as any;
}

test("Download happy path: HTTP 200 yields TransferComplete with FaultCode 0", async () => {
  const d = makeDevice();
  const sync = methods.Download(
    d,
    req(`<cwmp:Download><CommandKey>dl-ok</CommandKey><FileType>1 Firmware Upgrade Image</FileType><URL>${base}/firmware.bin</URL></cwmp:Download>`)
  );
  // Handler responds immediately with Status 1 (not fully applied yet).
  assert.match(sync, /<cwmp:DownloadResponse>/);
  assert.match(sync, /<Status>1<\/Status>/);

  const { event, xml } = await runTransfer(d, () => "");
  assert.equal(event, "7 TRANSFER COMPLETE,M Download");
  assert.match(xml!, /<cwmp:TransferComplete>/);
  assert.match(xml!, /<CommandKey>dl-ok<\/CommandKey>/);
  assert.match(xml!, /<FaultCode>0<\/FaultCode>/);
});

test("Download failure: HTTP 404 yields TransferComplete with FaultCode 9010", async () => {
  const d = makeDevice();
  const { event, xml } = await runTransfer(d, () =>
    methods.Download(d, req(`<cwmp:Download><CommandKey>dl-bad</CommandKey><FileType>1 Firmware Upgrade Image</FileType><URL>${base}/fail</URL></cwmp:Download>`))
  );
  assert.equal(event, "7 TRANSFER COMPLETE,M Download");
  assert.match(xml!, /<CommandKey>dl-bad<\/CommandKey>/);
  assert.match(xml!, /<FaultCode>9010<\/FaultCode>/);
});

test("Upload happy path: reads the sample file and PUTs it, FaultCode 0", async () => {
  // "4 Vendor Log File" maps to ./sample/vendor-log.txt (relative to cwd).
  const dir = "sample";
  const file = `${dir}/vendor-log.txt`;
  const createdDir = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, "log line 1\nlog line 2\n");
  try {
    const d = makeDevice();
    const { event, xml } = await runTransfer(d, () =>
      methods.Upload(d, req(`<cwmp:Upload><CommandKey>up-ok</CommandKey><FileType>4 Vendor Log File</FileType><URL>${base}/upload</URL></cwmp:Upload>`))
    );
    assert.equal(event, "7 TRANSFER COMPLETE,M Upload");
    assert.match(xml!, /<CommandKey>up-ok<\/CommandKey>/);
    assert.match(xml!, /<FaultCode>0<\/FaultCode>/);
  } finally {
    rmSync(file, { force: true });
    if (createdDir) rmSync(dir, { recursive: true, force: true });
  }
});

test("Upload failure: missing local file yields FaultCode 9010", async () => {
  // "1 Firmware Upgrade Image" maps to ./sample/firmware.bin which does not exist.
  assert.equal(existsSync("sample/firmware.bin"), false);
  const d = makeDevice();
  const { event, xml } = await runTransfer(d, () =>
    methods.Upload(d, req(`<cwmp:Upload><CommandKey>up-bad</CommandKey><FileType>1 Firmware Upgrade Image</FileType><URL>${base}/upload</URL></cwmp:Upload>`))
  );
  assert.equal(event, "7 TRANSFER COMPLETE,M Upload");
  assert.match(xml!, /<CommandKey>up-bad<\/CommandKey>/);
  assert.match(xml!, /<FaultCode>9010<\/FaultCode>/);
});
