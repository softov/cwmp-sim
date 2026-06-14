"use strict";

import xmlUtils from "./xml-utils.ts";
import xmlParser from "./xml-parser.ts";
import CWMPDevice from "./cwmp-device.ts";
import type { XmlNode } from "./types.d.ts";
import TaskDownload from "./task-download.ts";
import TaskUpload from "./task-upload.ts";

// https://www.broadband-forum.org/pdfs/tr-069-1-5-0.pdf
// https://github.com/BroadbandForum/cwmp-data-models/blob/master/cwmp-1-2.xsd

// TR-069 Amendment 5, Annex A.5 - CPE Fault Codes
const FAULTCODE_METHOD_NOT_SUPPORTED = 9000;
const FAULTCODE_REQUEST_DENIED = 9001;
const FAULTCODE_INTERNAL_ERROR = 9002;
const FAULTCODE_INVALID_ARGUMENTS = 9003;
const FAULTCODE_RESOURCE_EXHAUSTED = 9004;
const FAULTCODE_INVALID_PNAME = 9005;
const FAULTCODE_INVALID_PTYPE = 9006;
const FAULTCODE_INVALID_PVALUE = 9007;
const FAULTCODE_INVALID_WRITE = 9008;
const FAULTCODE_REJECT_NOTIFICATION = 9009;
const FAULTCODE_DOWNLOAD_FAILED = 9010;
const FAULTCODE_UPLOAD_FAILED = 9011;
const FAULTCODE_TRANSFER_AUTH = 9012;
const FAULTCODE_TRANSFER_PROTOCOL = 9013;
const FAULTCODE_DOWNLOAD_MULTICAST = 9014;
const FAULTCODE_DOWNLOAD_SERVER = 9015;
const FAULTCODE_DOWNLOAD_ACCESS = 9016;
const FAULTCODE_DOWNLOAD_PARTIAL = 9017;
const FAULTCODE_DOWNLOAD_CORRUPT = 9018;
const FAULTCODE_DOWNLOAD_AUTH = 9019;

// TR-069 Amendment 5, Section A.3 - RPC Methods
const SUPPORTED_METHODS = [
  "GetRPCMethods",
  "SetParameterValues",
  "GetParameterValues",
  "GetParameterNames",
  "SetParameterAttributes",
  "GetParameterAttributes",
  "AddObject",
  "DeleteObject",
  "Download",
  "Upload",
  "Reboot",
  "FactoryReset",
  "ScheduleInform",
  "GetQueuedTransfers",
  "GetAllQueuedTransfers",
  "ScheduleDownload",
  "CancelTransfer"
];

// Helper to get standard inform params based on root
function getInformParams(rootName: string): string[] {
  return [
    `${rootName}.DeviceInfo.SpecVersion`,
    `${rootName}.DeviceInfo.HardwareVersion`,
    `${rootName}.DeviceInfo.SoftwareVersion`,
    `${rootName}.DeviceInfo.ProvisioningCode`,
    `${rootName}.ManagementServer.ParameterKey`,
    `${rootName}.ManagementServer.ConnectionRequestURL`,
    `${rootName}.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress`
  ];
}

/**
 * Constructs the Inform message to the ACS.
 * TR-069 Amendment 5, Section A.3.3.1 - Inform
 * Should be called after device initialization.
 * The expected response is {@link InformResponse}
 * 
 * @param {CWMPDevice} device 
 * @param {string} event - Event codes (comma separated).
 * @returns {string} The Inform XML.
 * 
 * @example
 * ```
 * const inform = Inform(device, "1 BOOT");
 * ```
 */
function Inform(device: CWMPDevice, event: string): string {
  device.setLastMethod("Inform");
  const root = device._rootName || "Device";
  let manufacturer = xmlUtils.node("Manufacturer", {}, xmlParser.encodeEntities(device.getValue(`${root}.DeviceInfo.Manufacturer`)));
  let oui = xmlUtils.node("OUI", {}, xmlParser.encodeEntities(device.getValue(`${root}.DeviceInfo.ManufacturerOUI`)));
  let pClass = xmlUtils.node("ProductClass", {}, xmlParser.encodeEntities(device.getValue(`${root}.DeviceInfo.ProductClass`)));
  let sNumber = xmlUtils.node("SerialNumber", {}, xmlParser.encodeEntities(device.getValue(`${root}.DeviceInfo.SerialNumber`)));
  let deviceId = xmlUtils.node("DeviceId", {}, [manufacturer, oui, pClass, sNumber]);

  let eventStruct = "";
  let splitEvents = event ? event.split(",") : [event];

  splitEvents.forEach(ev => {
    eventStruct += xmlUtils.node("EventStruct", {}, [
      xmlUtils.node("EventCode", {}, ev || "2 PERIODIC"),
      xmlUtils.node("CommandKey")
    ]);
  });

  let evnt = xmlUtils.node("Event", { "soap-enc:arrayType": `cwmp:EventStruct[${splitEvents.length}]` }, eventStruct);

  let params = [];
  const informParams = getInformParams(root);

  for (let p of informParams) {
    let param = device.get(p);
    if (!param) continue;
    params.push(xmlUtils.node("ParameterValueStruct", {}, [
      xmlUtils.node("Name", {}, p),
      xmlUtils.node("Value", { "xsi:type": param._type }, xmlParser.encodeEntities(param._value))
    ]));
  }

  let parameterList = xmlUtils.node("ParameterList", { "soap-enc:arrayType": `cwmp:ParameterValueStruct[${params.length}]` }, params);

  let informChildren = [
    deviceId,
    evnt,
    xmlUtils.node("MaxEnvelopes", {}, "1"),
    xmlUtils.node("CurrentTime", {}, new Date().toISOString()),
    xmlUtils.node("RetryCount", {}, "0"),
    parameterList
  ];

  device.setLastMethod('Inform');
  let informBox = xmlUtils.node("cwmp:Inform", {}, informChildren);
  return informBox;
}

/**
 * Constructs an empty HTTP request (Heartbeat).
 * If any message is pending to be sent, it will be sent.
 * 
 * @param {CWMPDevice} device - The device instance.
 * @param {XmlNode} request - The InformResponse XML.
 * @returns {string} The empty HTTP request.
 */
function _baseCaller(device: CWMPDevice, request: XmlNode): string {
  device.setLastMethod("_");
  // now we check if any message is pending to be done
  let message = device.getNextMessage();
  if (message) return message();
  return "";
}

/**
 * Handles the response of the Inform message from the ACS.
 * Is called automatically when receiving the InformResponse from the ACS.
 * 
 * @param {CWMPDevice} device - The device instance.
 * @param {XmlNode} request - The InformResponse XML.
 * @returns {string} @see {@link _baseCaller}
 */
function InformResponse(device: CWMPDevice, request: XmlNode): string {
  if (device._lastMethod !== "Inform") {
    console.error("❌ Received InformResponse but expected response for " + device._lastMethod);
  }
  device.setLastMethod(null);
  // Default flow: Send Empty Request (Heartbeat)
  return _baseCaller(device, request);
}

/**
 * Handles GetParameterValues RPC.
 * TR-069 Amendment 5, Section A.3.2.2 - GetParameterValues
 * 
 * @param {CWMPDevice} device - The device instance.
 * @param {XmlNode} request - The GetParameterValues XML.
 * @returns {string} The GetParameterValuesResponse XML.
 */
function GetParameterValues(device: CWMPDevice, request: XmlNode): string {
  let parameterNames = request.children[0].children;
  let params = [];

  for (let p of parameterNames) {
    let name = p.text;

    // Use getLeaves if available (supports Partial Paths)
    if (typeof device.getLeaves === 'function') {
      const leaves = device.getLeaves(name);
      for (let leaf of leaves) {
        params.push(xmlUtils.node("ParameterValueStruct", {}, [
          xmlUtils.node("Name", {}, leaf.name),
          xmlUtils.node("Value", { "xsi:type": leaf.type }, xmlParser.encodeEntities(leaf.value))
        ]));
      }
    } else {
      // Fallback
      let param = device.get(name);
      if (param) {
        params.push(xmlUtils.node("ParameterValueStruct", {}, [
          xmlUtils.node("Name", {}, name),
          xmlUtils.node("Value", { "xsi:type": param[2] }, xmlParser.encodeEntities(param[1]))
        ]));
      }
    }
  }

  device.setLastMethod('GetParameterValuesResponse');
  let response = xmlUtils.node("cwmp:GetParameterValuesResponse", {},
    xmlUtils.node("ParameterList", { "soap-enc:arrayType": `cwmp:ParameterValueStruct[${params.length}]` }, params)
  );
  return response;
}

/**
 * Handles GetParameterNames RPC.
 * TR-069 Amendment 5, Section A.3.2.3 - GetParameterNames
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The GetParameterNamesResponse XML.
 */
function GetParameterNames(device: CWMPDevice, request: XmlNode): string {
  let parameterPath = "";
  let nextLevel = false;

  for (let c of request.children) {
    if (c.localName === "ParameterPath") parameterPath = c.text;
    else if (c.localName === "NextLevel") nextLevel = (c.text === "1" || c.text === "true");
  }

  let names = [];
  if (device.getParameterNames) {
    names = device.getParameterNames(parameterPath, nextLevel);
  }

  let params = [];
  for (let n of names) {
    params.push(xmlUtils.node("ParameterInfoStruct", {}, [
      xmlUtils.node("Name", {}, n.name),
      xmlUtils.node("Writable", {}, String(n.writable))
    ]));
  }

  let response = xmlUtils.node("cwmp:GetParameterNamesResponse", {},
    xmlUtils.node("ParameterList", { "soap-enc:arrayType": `cwmp:ParameterInfoStruct[${params.length}]` }, params)
  );

  return response;
}

/**
 * Handles SetParameterValues RPC.
 * TR-069 Amendment 5, Section A.3.2.1 - SetParameterValues
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The SetParameterValuesResponse XML.
 */
function SetParameterValues(device: CWMPDevice, request: XmlNode): string {
  // ... implementation ...
  let parameterValues = request.children[0].children;
  const failed: string[] = [];

  if (device._lastSetValues) {
    device._lastSetValues.clear();
  } else {
    device._lastSetValues = new Map();
  }

  device._keepEvents = true;
  for (let p of parameterValues) {
    let name: string, value: string;
    for (let c of p.children) {
      if (c.localName === "Name") name = c.text;
      else if (c.localName === "Value") value = c.text;
    }
    device._lastSetValues.set(name, value);
    if (!device.set(name, value)) {
      console.log(`Failed to update ${name}`);
      failed.push(name);
    }
  }

  device._keepEvents = false;

  // TR-069 Amendment 5, Section A.3.2.1: if one or more parameters cannot be
  // set, the CPE MUST respond with a fault rather than a (false) success status.
  if (failed.length) {
    return xmlUtils.fault(
      FAULTCODE_INVALID_WRITE,
      "Invalid arguments",
      `Unable to set parameter(s): ${failed.join(", ")}`
    );
  }

  for (let [name, value] of device._lastSetValues) {
    device.fireEvent('set', name, value)
  }

  let response = xmlUtils.node("cwmp:SetParameterValuesResponse", {}, xmlUtils.node("Status", {}, "0"));
  return response;
}

/**
 * Handles AddObject RPC.
 * TR-069 Amendment 5, Section A.3.2.6 - AddObject
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The AddObjectResponse XML.
 */
function AddObject(device: CWMPDevice, request: XmlNode): string {
  let objectName = "";
  let parameterKey = "";

  for (let c of request.children) {
    if (c.localName === "ObjectName") objectName = c.text;
    else if (c.localName === "ParameterKey") parameterKey = c.text;
  }

  console.log(`AddObject requested. Object: ${objectName} Key: ${parameterKey}`);

  const [status, instanceNum] = device.addObject(objectName);

  let response = xmlUtils.node("cwmp:AddObjectResponse", {}, [
    xmlUtils.node("InstanceNumber", {}, String(instanceNum)),
    xmlUtils.node("Status", {}, String(status))
  ]);

  return response;
}

/**
 * Handles DeleteObject RPC.
 * TR-069 Amendment 5, Section A.3.2.7 - DeleteObject
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The DeleteObjectResponse XML.
 */
function DeleteObject(device: CWMPDevice, request: XmlNode): string {
  let objectName = "";
  let parameterKey = "";

  for (let c of request.children) {
    if (c.localName === "ObjectName") objectName = c.text;
    else if (c.localName === "ParameterKey") parameterKey = c.text;
  }

  console.log(`DeleteObject requested. Object: ${objectName} Key: ${parameterKey}`);

  const status = device.deleteObject(objectName);

  let response = xmlUtils.node("cwmp:DeleteObjectResponse", {}, [
    xmlUtils.node("Status", {}, String(status))
  ]);

  return response;
}

/**
 * Handles TransferCompleteResponse RPC.
 * 
 * @param {CWMPDevice} device - The device instance.
 * @param {XmlNode} request - The TransferCompleteResponse XML.
 * @returns {string} @see {@link _baseCaller}
 */
function TransferCompleteResponse(device: CWMPDevice, request: XmlNode): string {
  if (device._lastMethod !== "TransferComplete") {
    console.error("❌ Received TransferCompleteResponse but expected response for " + device._lastMethod);
  }
  device.setLastMethod(null);
  return _baseCaller(device, request);
}

/**
 * Handles Download RPC.
 * TR-069 Amendment 5, Section A.3.2.8 - Download
 * Initiates a TaskDownload to perform the file transfer asynchronously.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The DownloadResponse XML.
 */
function Download(device: CWMPDevice, request: XmlNode): string {
  let commandKey = "";
  let url = "";
  let fileType = "";
  let username = "";
  let password = "";
  let delay = 0;

  for (let c of request.children) {
    if (c.localName === "CommandKey") commandKey = c.text;
    else if (c.localName === "URL") url = c.text;
    else if (c.localName === "FileType") fileType = c.text;
    else if (c.localName === "Username") username = c.text;
    else if (c.localName === "Password") password = c.text;
    else if (c.localName === "DelaySeconds") delay = parseInt(c.text);
  }

  // Validation: FileType is required
  if (!fileType || fileType.trim() === "") {
    console.error("❌ Download failed: FileType is required");
    return xmlUtils.fault(FAULTCODE_INVALID_ARGUMENTS, "Invalid arguments", "FileType is required for Download RPC");
  }

  // Validation: URL is required
  if (!url || url.trim() === "") {
    console.error("❌ Download failed: URL is required");
    return xmlUtils.fault(FAULTCODE_INVALID_ARGUMENTS, "Invalid arguments", "URL is required for Download RPC");
  }

  // Validation: Check for transfer already in progress
  const queuedTransfer = device._queuedTransfers.find((t) =>
    t.isDownload &&
    (t.state === 1 || t.state === 2) // NotYetStarted or InProgress
  );

  if (queuedTransfer) {
    console.error(`❌ Download failed: Transfer already in progress (CommandKey: ${queuedTransfer.commandKey})`);
    return xmlUtils.fault(FAULTCODE_DOWNLOAD_FAILED, "Download failure", `Transfer already in progress with CommandKey: ${queuedTransfer.commandKey}`);
  }

  console.log(`Download requested. URL: ${url}, FileType: ${fileType}, Key: ${commandKey}`);

  const task = new TaskDownload(device, {
    commandKey,
    fileType,
    url,
    username,
    password,
    delay
  });
  task.dispatch();
  device.setLastMethod('DownloadResponse');
  let response = xmlUtils.node("cwmp:DownloadResponse", {}, [
    xmlUtils.node("Status", {}, "1"), // 1 = Not fully applied yet
    xmlUtils.node("StartTime", {}, "0001-01-01T00:00:00Z"),
    xmlUtils.node("CompleteTime", {}, "0001-01-01T00:00:00Z")
  ]);

  return response;
}

/**
 * Handles Upload RPC.
 * TR-069 Amendment 5, Section A.4.1.5 - Upload (Optional)
 * Initiates a TaskUpload to perform the file transfer asynchronously.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The UploadResponse XML.
 */
function Upload(device: CWMPDevice, request: XmlNode): string {
  let commandKey = "";
  let url = "";
  let fileType = "";
  let username = "";
  let password = "";
  let delay = 0;

  for (let c of request.children) {
    if (c.localName === "CommandKey") commandKey = c.text;
    else if (c.localName === "URL") url = c.text;
    else if (c.localName === "FileType") fileType = c.text;
    else if (c.localName === "Username") username = c.text;
    else if (c.localName === "Password") password = c.text;
    else if (c.localName === "DelaySeconds") delay = parseInt(c.text);
  }

  // Validation: FileType is required
  if (!fileType || fileType.trim() === "") {
    console.error("❌ Upload failed: FileType is required");
    return xmlUtils.fault(FAULTCODE_INVALID_ARGUMENTS, "Invalid arguments", "FileType is required for Upload RPC");
  }

  // Validation: URL is required
  if (!url || url.trim() === "") {
    console.error("❌ Upload failed: URL is required");
    return xmlUtils.fault(FAULTCODE_INVALID_ARGUMENTS, "Invalid arguments", "URL is required for Upload RPC");
  }

  // Validation: Check for upload already in progress
  const queuedTransfer = device._queuedTransfers.find((t) =>
    !t.isDownload &&
    (t.state === 1 || t.state === 2) // NotYetStarted or InProgress
  );

  if (queuedTransfer) {
    console.error(`❌ Upload failed: Transfer already in progress (CommandKey: ${queuedTransfer.commandKey})`);
    return xmlUtils.fault(FAULTCODE_UPLOAD_FAILED, "Upload failure", `Transfer already in progress with CommandKey: ${queuedTransfer.commandKey}`);
  }

  console.log(`Upload requested. URL: ${url}, FileType: ${fileType}, Key: ${commandKey}`);

  const task = new TaskUpload(device, {
    commandKey,
    url,
    username,
    password,
    delay,
    fileType
  });
  task.dispatch();
  device.setLastMethod('UploadResponse');
  let response = xmlUtils.node("cwmp:UploadResponse", {}, [
    xmlUtils.node("Status", {}, "1"), // 1 = Not fully applied yet
    xmlUtils.node("StartTime", {}, "0001-01-01T00:00:00Z"),
    xmlUtils.node("CompleteTime", {}, "0001-01-01T00:00:00Z")
  ]);

  return response;
}


/**
 * Handles Reboot RPC.
 * TR-069 Amendment 5, Section A.3.2.9 - Reboot
 * Marks the device for a pending reboot in 5 seconds.
 * @param {CWMPDevice} device - The simulated device instance.
 * 
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The RebootResponse XML.
 */
function Reboot(device: CWMPDevice, request: XmlNode): string {
  console.log("Reboot requested.");
  device.setLastMethod('RebootResponse');
  device._pendingReboot = true;
  let response = xmlUtils.node("cwmp:RebootResponse", {}, "");
  return response;
}

/**
 * Handles FactoryReset RPC.
 * TR-069 Amendment 5, Section A.4.1.6 - FactoryReset (Optional)
 * Marks the device for a pending factory reset in 5 seconds.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The FactoryResetResponse XML.
 */
function FactoryReset(device: CWMPDevice, request: XmlNode): string {
  console.log("FactoryReset requested.");
  device.setLastMethod('FactoryResetResponse');
  device._pendingFactoryReset = true;
  let response = xmlUtils.node("cwmp:FactoryResetResponse", {}, "");
  return response;
}

/**
 * Handles GetRPCMethods RPC.
 * TR-069 Amendment 5, Section A.3.1.1 - GetRPCMethods
 * Returns the list of RPC methods supported by this CPE.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The GetRPCMethodsResponse XML.
 */
function GetRPCMethods(device: CWMPDevice, request: XmlNode): string {
  console.log("GetRPCMethods requested.");

  let methodList = SUPPORTED_METHODS.map(m => xmlUtils.node("string", {}, m));

  let response = xmlUtils.node("cwmp:GetRPCMethodsResponse", {},
    xmlUtils.node("MethodList", { "soap-enc:arrayType": `xsd:string[${methodList.length}]` }, methodList)
  );

  return response;
}

/**
 * Handles SetParameterAttributes RPC.
 * TR-069 Amendment 5, Section A.3.2.4 - SetParameterAttributes
 * Sets notification attributes for parameters.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The SetParameterAttributesResponse XML.
 */
function SetParameterAttributes(device: CWMPDevice, request: XmlNode): string {
  let parameterList = request.children[0]?.children || [];

  for (let p of parameterList) {
    let name = "";
    let notification = 0;
    let accessList: string[] = [];
    let notificationChange = false;
    let accessListChange = false;

    for (let c of p.children) {
      if (c.localName === "Name") name = c.text;
      else if (c.localName === "NotificationChange") notificationChange = (c.text === "1" || c.text === "true");
      else if (c.localName === "Notification") notification = parseInt(c.text || "0");
      else if (c.localName === "AccessListChange") accessListChange = (c.text === "1" || c.text === "true");
      else if (c.localName === "AccessList") {
        for (let subscriber of c.children) {
          if (subscriber.text) accessList.push(subscriber.text);
        }
      }
    }

    console.log(`SetParameterAttributes: ${name} notification=${notification} accessList=[${accessList.join(", ")}]`);

    // Store attributes
    let existing = device._parameterAttributes.get(name) || { notification: 0, accessList: [] };
    if (notificationChange) existing.notification = notification;
    if (accessListChange) existing.accessList = accessList;
    device._parameterAttributes.set(name, existing);
  }

  let response = xmlUtils.node("cwmp:SetParameterAttributesResponse", {}, "");
  return response;
}

/**
 * Handles GetParameterAttributes RPC.
 * TR-069 Amendment 5, Section A.3.2.5 - GetParameterAttributes
 * Returns notification attributes for specified parameters.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The GetParameterAttributesResponse XML.
 */
function GetParameterAttributes(device: CWMPDevice, request: XmlNode): string {
  let parameterNames = request.children[0]?.children || [];
  let params = [];

  for (let p of parameterNames) {
    let name = p.text;
    let attr = device._parameterAttributes.get(name) || { notification: 0, accessList: [] };

    let accessListNodes = attr.accessList.map(sub => xmlUtils.node("string", {}, sub)).join("");

    params.push(xmlUtils.node("ParameterAttributeStruct", {}, [
      xmlUtils.node("Name", {}, name),
      xmlUtils.node("Notification", {}, String(attr.notification)),
      xmlUtils.node("AccessList", { "soap-enc:arrayType": `xsd:string[${attr.accessList.length}]` }, accessListNodes)
    ]));
  }

  let response = xmlUtils.node("cwmp:GetParameterAttributesResponse", {},
    xmlUtils.node("ParameterList", { "soap-enc:arrayType": `cwmp:ParameterAttributeStruct[${params.length}]` }, params)
  );

  return response;
}

/**
 * Handles ScheduleInform RPC.
 * TR-069 Amendment 5, Section A.4.1.2 - ScheduleInform (Optional)
 * Schedules the CPE to create an Inform at the specified time.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The ScheduleInformResponse XML.
 */
function ScheduleInform(device: CWMPDevice, request: XmlNode): string {
  let delaySeconds = 0;
  let commandKey = "";

  for (let c of request.children) {
    if (c.localName === "DelaySeconds") delaySeconds = parseInt(c.text || "0");
    else if (c.localName === "CommandKey") commandKey = c.text;
  }

  console.log(`ScheduleInform requested. Delay: ${delaySeconds}s, Key: ${commandKey}`);

  // Schedule the inform
  const scheduleTime = new Date(Date.now() + delaySeconds * 1000).toISOString();
  device._scheduledInform = { commandKey, time: scheduleTime };

  // TODO: Actually schedule the inform event
  // For now, just store it

  let response = xmlUtils.node("cwmp:ScheduleInformResponse", {}, "");
  return response;
}

/**
 * TR-069 Amendment 5, Section A.4.1.1 - GetQueuedTransfers (Optional)
 * 
 * Returns basic transfer information using QueuedTransferStruct.
 * Fields: CommandKey, State
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The GetQueuedTransfersResponse XML.
 */
function GetQueuedTransfers(device: CWMPDevice, request: XmlNode): string {
  console.log("GetQueuedTransfers requested (basic struct).");

  let transfers = device._queuedTransfers.map((t) => {
    return xmlUtils.node("QueuedTransferStruct", {}, [
      xmlUtils.node("CommandKey", {}, t.commandKey || ""),
      xmlUtils.node("State", {}, String(t.state || 1)) // 1=NotYetStarted, 2=InProgress, 3=Completed
    ]);
  }).join("");

  let response = xmlUtils.node("cwmp:GetQueuedTransfersResponse", {},
    xmlUtils.node("TransferList", { "soap-enc:arrayType": `cwmp:QueuedTransferStruct[${device._queuedTransfers.length}]` }, transfers)
  );

  return response;
}

/**
 * TR-069 Amendment 5, Section A.4.1.1 - GetAllQueuedTransfers (Optional)
 * 
 * Returns extended transfer information using AllQueuedTransferStruct.
 * Fields: CommandKey, State, IsDownload, FileType, FileSize, TargetFileName
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The GetAllQueuedTransfersResponse XML.
 */
function GetAllQueuedTransfers(device: CWMPDevice, request: XmlNode): string {
  console.log("GetAllQueuedTransfers requested (extended struct).");

  let transfers = device._queuedTransfers.map((t) => {
    return xmlUtils.node("AllQueuedTransferStruct", {}, [
      xmlUtils.node("CommandKey", {}, t.commandKey || ""),
      xmlUtils.node("State", {}, String(t.state || 1)), // 1=NotYetStarted, 2=InProgress, 3=Completed
      xmlUtils.node("IsDownload", {}, t.isDownload ? "1" : "0"),
      xmlUtils.node("FileType", {}, t.fileType || ""),
      xmlUtils.node("FileSize", {}, String(t.fileSize || 0)),
      xmlUtils.node("TargetFileName", {}, t.targetFileName || "")
    ]);
  }).join("");

  let response = xmlUtils.node("cwmp:GetAllQueuedTransfersResponse", {},
    xmlUtils.node("TransferList", { "soap-enc:arrayType": `cwmp:AllQueuedTransferStruct[${device._queuedTransfers.length}]` }, transfers)
  );

  return response;
}

/**
 * TR-069 Amendment 5, Section A.4.1.8 - ScheduleDownload (Optional)
 * 
 * This method MAY be used by an ACS to schedule a download to occur at a future time.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The ScheduleDownloadResponse XML.
 */
function ScheduleDownload(device: CWMPDevice, request: XmlNode): string {
  let commandKey = "";
  let url = "";
  let fileType = "";
  let username = "";
  let password = "";
  let fileSize = 0;
  let timeWindowStart = 0;
  let timeWindowEnd = 0;

  for (let c of request.children) {
    if (c.localName === "CommandKey") commandKey = c.text;
    else if (c.localName === "URL") url = c.text;
    else if (c.localName === "FileType") fileType = c.text;
    else if (c.localName === "Username") username = c.text;
    else if (c.localName === "Password") password = c.text;
    else if (c.localName === "FileSize") fileSize = parseInt(c.text || "0");
    else if (c.localName === "TimeWindowStart") timeWindowStart = parseInt(c.text || "0");
    else if (c.localName === "TimeWindowEnd") timeWindowEnd = parseInt(c.text || "0");
  }

  console.log(`ScheduleDownload requested. URL: ${url}, Key: ${commandKey}`);

  // Add to queue
  device._queuedTransfers.push({
    commandKey,
    state: 1, // NotYetStarted
    isDownload: true,
    fileType,
    url,
    username,
    password,
    delay: timeWindowStart,
    startTime: "0001-01-01T00:00:00Z",
    completeTime: "0001-01-01T00:00:00Z"
  });

  let response = xmlUtils.node("cwmp:ScheduleDownloadResponse", {}, "");
  return response;
}

/**
 * Handles CancelTransfer RPC.
 * TR-069 Amendment 5, Section A.4.1.9 - CancelTransfer (Optional)
 * Cancels a queued or in-progress file transfer.
 * 
 * @param {CWMPDevice} device - The simulated device instance.
 * @param {XmlNode} request - The XML request object.
 * @returns {string} The CancelTransferResponse XML.
 */
function CancelTransfer(device: CWMPDevice, request: XmlNode): string {
  let commandKey = "";

  for (let c of request.children) {
    if (c.localName === "CommandKey") commandKey = c.text;
  }

  console.log(`CancelTransfer requested. Key: ${commandKey}`);

  // Find and remove from queue
  const index = device._queuedTransfers.findIndex(t => t.commandKey === commandKey);
  if (index !== -1) {
    device._queuedTransfers.splice(index, 1);
  }

  let response = xmlUtils.node("cwmp:CancelTransferResponse", {}, "");
  return response;
}


export default {
  _baseCaller: _baseCaller,
  Inform: Inform,
  InformResponse: InformResponse,
  TransferCompleteResponse: TransferCompleteResponse,
  GetParameterValues: GetParameterValues,
  GetParameterNames: GetParameterNames,
  SetParameterValues: SetParameterValues,
  AddObject: AddObject,
  DeleteObject: DeleteObject,
  Download: Download,
  Upload: Upload,
  Reboot: Reboot,
  FactoryReset: FactoryReset,
  GetRPCMethods: GetRPCMethods,
  SetParameterAttributes: SetParameterAttributes,
  GetParameterAttributes: GetParameterAttributes,
  ScheduleInform: ScheduleInform,
  GetQueuedTransfers: GetQueuedTransfers,
  GetAllQueuedTransfers: GetAllQueuedTransfers,
  ScheduleDownload: ScheduleDownload,
  CancelTransfer: CancelTransfer
}
