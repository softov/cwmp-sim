import { test } from "node:test";
import assert from "node:assert/strict";

import methods from "../src/cwmp-methods.ts";
import CWMPDevice from "../src/cwmp-device.ts";
import xmlParser from "../src/xml-parser.ts";

// Each handler receives the parsed RPC element as its `request`. Build one by
// parsing a SOAP body fragment and grabbing the top-level RPC node.
function rpc(xml: string) {
  return xmlParser.parseXml(xml).children[0] as any;
}

function makeDevice() {
  return new CWMPDevice({ rootName: "InternetGatewayDevice", serialNumber: "SN-TEST" });
}

const SERIAL = "InternetGatewayDevice.DeviceInfo.SerialNumber"; // read-only
const PROVCODE = "InternetGatewayDevice.DeviceInfo.ProvisioningCode"; // writable

test("GetRPCMethods lists every supported method", () => {
  const out = methods.GetRPCMethods(makeDevice(), rpc("<cwmp:GetRPCMethods/>"));
  assert.match(out, /<cwmp:GetRPCMethodsResponse>/);
  for (const m of ["GetParameterValues", "SetParameterValues", "AddObject", "Reboot", "CancelTransfer"]) {
    assert.match(out, new RegExp(`<string>${m}</string>`));
  }
});

test("GetParameterValues returns the value of a known leaf", () => {
  const req = rpc(
    `<cwmp:GetParameterValues><ParameterNames><string>${SERIAL}</string></ParameterNames></cwmp:GetParameterValues>`
  );
  const out = methods.GetParameterValues(makeDevice(), req);
  assert.match(out, new RegExp(`<Name>${SERIAL}</Name>`));
  assert.match(out, /<Value xsi:type="xsd:string">SN-TEST<\/Value>/);
});

test("GetParameterNames returns child parameter info", () => {
  const req = rpc(
    `<cwmp:GetParameterNames><ParameterPath>InternetGatewayDevice.DeviceInfo</ParameterPath><NextLevel>true</NextLevel></cwmp:GetParameterNames>`
  );
  const out = methods.GetParameterNames(makeDevice(), req);
  assert.match(out, new RegExp(`<Name>${SERIAL}</Name>`));
  assert.match(out, /<Writable>false<\/Writable>/);
});

test("SetParameterValues applies a writable parameter and returns Status 0", () => {
  const d = makeDevice();
  const req = rpc(
    `<cwmp:SetParameterValues><ParameterList><ParameterValueStruct><Name>${PROVCODE}</Name><Value>PROV-9</Value></ParameterValueStruct></ParameterList></cwmp:SetParameterValues>`
  );
  const out = methods.SetParameterValues(d, req);
  assert.match(out, /<cwmp:SetParameterValuesResponse><Status>0<\/Status>/);
  assert.equal(d.getValue(PROVCODE), "PROV-9");
});

test("SetParameterValues faults when a write fails (read-only parameter)", () => {
  const d = makeDevice();
  const req = rpc(
    `<cwmp:SetParameterValues><ParameterList><ParameterValueStruct><Name>${SERIAL}</Name><Value>HACKED</Value></ParameterValueStruct></ParameterList></cwmp:SetParameterValues>`
  );
  const out = methods.SetParameterValues(d, req);
  assert.match(out, /<soap:Fault>/);
  assert.match(out, /<FaultCode>9008<\/FaultCode>/); // 9008 = non-writable parameter
  assert.equal(d.getValue(SERIAL), "SN-TEST"); // unchanged
});

test("AddObject and DeleteObject mutate the tree and report status", () => {
  const d = makeDevice();
  const base = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.PortMapping";

  const addOut = methods.AddObject(d, rpc(`<cwmp:AddObject><ObjectName>${base}.</ObjectName></cwmp:AddObject>`));
  assert.match(addOut, /<InstanceNumber>1<\/InstanceNumber>/);
  assert.match(addOut, /<Status>0<\/Status>/);
  // The instance is a container; prove it exists via one of its leaves.
  assert.equal(d.getValue(`${base}.1.ExternalPort`), "0");

  const delOut = methods.DeleteObject(d, rpc(`<cwmp:DeleteObject><ObjectName>${base}.1</ObjectName></cwmp:DeleteObject>`));
  assert.match(delOut, /<cwmp:DeleteObjectResponse><Status>0<\/Status>/);
  assert.equal(d.getValue(`${base}.1.ExternalPort`), ""); // gone
});

test("Reboot and FactoryReset set their pending flags", () => {
  const d = makeDevice();
  assert.match(methods.Reboot(d, rpc("<cwmp:Reboot/>")), /<cwmp:RebootResponse\/>/);
  assert.equal(d._pendingReboot, true);

  assert.match(methods.FactoryReset(d, rpc("<cwmp:FactoryReset/>")), /<cwmp:FactoryResetResponse\/>/);
  assert.equal(d._pendingFactoryReset, true);
});

test("Set/GetParameterAttributes round-trips notification and access list", () => {
  const d = makeDevice();
  const setReq = rpc(
    `<cwmp:SetParameterAttributes><ParameterList><SetParameterAttributesStruct><Name>${PROVCODE}</Name><NotificationChange>true</NotificationChange><Notification>2</Notification><AccessListChange>true</AccessListChange><AccessList><string>Subscriber</string></AccessList></SetParameterAttributesStruct></ParameterList></cwmp:SetParameterAttributes>`
  );
  methods.SetParameterAttributes(d, setReq);
  assert.deepEqual(d._parameterAttributes.get(PROVCODE), { notification: 2, accessList: ["Subscriber"] });

  const getReq = rpc(`<cwmp:GetParameterAttributes><ParameterNames><string>${PROVCODE}</string></ParameterNames></cwmp:GetParameterAttributes>`);
  const out = methods.GetParameterAttributes(d, getReq);
  assert.match(out, /<Notification>2<\/Notification>/);
  assert.match(out, /<string>Subscriber<\/string>/);
});

test("ScheduleInform stores the command key", () => {
  const d = makeDevice();
  const out = methods.ScheduleInform(d, rpc("<cwmp:ScheduleInform><DelaySeconds>30</DelaySeconds><CommandKey>job-1</CommandKey></cwmp:ScheduleInform>"));
  assert.match(out, /<cwmp:ScheduleInformResponse\/>/);
  assert.equal(d._scheduledInform?.commandKey, "job-1");
});

test("ScheduleDownload queues a transfer that the getters serialize", () => {
  const d = makeDevice();
  methods.ScheduleDownload(d, rpc("<cwmp:ScheduleDownload><CommandKey>dl-1</CommandKey><URL>http://x/f.bin</URL><FileType>1 Firmware Upgrade Image</FileType></cwmp:ScheduleDownload>"));
  assert.equal(d._queuedTransfers.length, 1);
  assert.equal(d._queuedTransfers[0].commandKey, "dl-1");

  const basic = methods.GetQueuedTransfers(d, rpc("<cwmp:GetQueuedTransfers/>"));
  assert.match(basic, /<CommandKey>dl-1<\/CommandKey>/);
  assert.match(basic, /<State>1<\/State>/);

  const all = methods.GetAllQueuedTransfers(d, rpc("<cwmp:GetAllQueuedTransfers/>"));
  assert.match(all, /<IsDownload>1<\/IsDownload>/);
});

test("CancelTransfer removes a queued transfer by command key", () => {
  const d = makeDevice();
  methods.ScheduleDownload(d, rpc("<cwmp:ScheduleDownload><CommandKey>dl-1</CommandKey><URL>http://x</URL><FileType>1 Firmware Upgrade Image</FileType></cwmp:ScheduleDownload>"));
  assert.equal(d._queuedTransfers.length, 1);

  methods.CancelTransfer(d, rpc("<cwmp:CancelTransfer><CommandKey>dl-1</CommandKey></cwmp:CancelTransfer>"));
  assert.equal(d._queuedTransfers.length, 0);
});

// --- Download / Upload: validation/fault branches only (happy path does network I/O) ---

test("Download faults on missing FileType or URL", () => {
  const d = makeDevice();
  const noType = methods.Download(d, rpc("<cwmp:Download><URL>http://x/f.bin</URL></cwmp:Download>"));
  assert.match(noType, /<FaultCode>9003<\/FaultCode>/);

  const noUrl = methods.Download(d, rpc("<cwmp:Download><FileType>1 Firmware Upgrade Image</FileType></cwmp:Download>"));
  assert.match(noUrl, /<FaultCode>9003<\/FaultCode>/);
  assert.equal(d._queuedTransfers.length, 0); // no task created
});

test("Download faults when another download is already in progress", () => {
  const d = makeDevice();
  d._queuedTransfers.push({
    commandKey: "running", state: 2, isDownload: true, fileType: "1 Firmware Upgrade Image",
    url: "http://x", username: "", password: "", delay: 0, startTime: "", completeTime: "",
  });
  const out = methods.Download(d, rpc("<cwmp:Download><URL>http://x/f.bin</URL><FileType>1 Firmware Upgrade Image</FileType></cwmp:Download>"));
  assert.match(out, /<FaultCode>9010<\/FaultCode>/); // download failure
});

test("Upload faults on missing FileType", () => {
  const d = makeDevice();
  const out = methods.Upload(d, rpc("<cwmp:Upload><URL>http://x</URL></cwmp:Upload>"));
  assert.match(out, /<FaultCode>9003<\/FaultCode>/);
});

test("Upload faults when another upload is already in progress", () => {
  const d = makeDevice();
  // An in-progress UPLOAD (isDownload: false) must block a new upload.
  d._queuedTransfers.push({
    commandKey: "uprun", state: 2, isDownload: false, fileType: "3 Vendor Log File",
    url: "http://x", username: "", password: "", delay: 0, startTime: "", completeTime: "",
  });
  const out = methods.Upload(d, rpc("<cwmp:Upload><URL>http://x</URL><FileType>3 Vendor Log File</FileType></cwmp:Upload>"));
  assert.match(out, /<FaultCode>9011<\/FaultCode>/); // upload failure
});
