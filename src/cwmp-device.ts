"use strict";

import models from "./cwmp-model.ts";
import fs from "node:fs/promises";
import type { CwmpNode, CwmpDeviceOptions } from "./types.ts";
import DiagPing from "./diag-ping.ts";
import DiagTraceroute from "./diag-traceroute.ts";
import DiagDownload from "./diag-download.ts";
import DiagUpload from "./diag-upload.ts";
import DiagWifi from "./diag-wifi.ts";
import CWMPTask from "./cwmp-task.ts";
import { NULL_LOGGER, type Logger } from "./logger.ts";
import CwmpParams from "./cwmp-params.ts";
import CwmpHttp from "./cwmp-http.ts";
import methods from "./cwmp-methods.ts";
import soap from "./cwmp-soap.ts";
import xmlParser from "./xml-parser.ts";
import { applyTemplate } from "./config/template.ts";
import { convertObjectToCwmp } from "./template/json.ts";
import * as crypto from "node:crypto";

/**
 * Derives a device's Connection Request URL path segment from its serial.
 * Exported so the scheme can be verified independently.
 */
export function hashConnectionPath(serial: string): string {
  return crypto.createHash("md5").update(serial).digest("hex").slice(0, 8);
}

/**
 * Represents the simulated CPE device.
 * Manages the data model (parameters), event listeners, and internal state.
 */
export default class CWMPDevice {
  _type = "Device";
  _manufacturer = "BrByte";
  _oui = "FFFFFF";
  _productClass = "Simulator";
  _serialNumber = "123456";
  _csvPath: string | null = null;
  _jsonPath: string | null = null;
  _log: Logger = NULL_LOGGER;
  _mac: string = "";
  _connHash: string | null = null;
  _rootName: string = "Device";
  _rootTree: any;
  _params!: CwmpParams;
  _keepEvents = false;
  listeners: Map<string, Set<Function>>;
  _pendingReboot = false;
  _pendingFactoryReset = false;
  _pendingMessages: Function[] = [];
  _pendingTask: CWMPTask[] = [];
  _pendingTimeout = null;
  _lastMethod: string | null = null;
  _lastSetValues: Map<string, string> | null = null;
  _parameterAttributes: Map<string, { notification: number; accessList: string[] }> = new Map();
  _queuedTransfers: Array<{
    commandKey: string;
    state: number;
    isDownload: boolean;
    fileType: string;
    url: string;
    username: string;
    password: string;
    delay: number;
    startTime: string;
    completeTime: string;
    fileSize?: number;
    targetFileName?: string;
  }> = [];
  _scheduledInform: { commandKey: string; time: string } | null = null;
  // CWMP session (outbound to the ACS) — created lazily in start()
  _httpClient: CwmpHttp | null = null;
  _requestId: string | null = null;
  _periodicInformTimeout: any = null;
  _periodicInformInterval = 30000;
  _periodicInformDisabled = false;
  _diag: {
    ping: DiagPing;
    traceroute: DiagTraceroute;
    download: DiagDownload;
    upload: DiagUpload;
    wifi: DiagWifi;
  };
  /**
   * Creates a new CWMPDevice instance.
   * @param {string} type - Root object name (e.g., "Device" or "InternetGatewayDevice").
   * @param {string} serialNumber - Device serial number.
   * @param {string} oui - Device OUI.
   * @param {string} productClass - Device product class.
   */
  constructor(options: CwmpDeviceOptions) {
    if (options.csvPath != undefined) this._csvPath = options.csvPath;
    if (options.jsonPath != undefined) this._jsonPath = options.jsonPath;
    if (options.logger) this._log = options.logger;

    // Resolve {i} identity templates against this device's own index.
    const idx = options.index ?? 0;
    if (options.mac) this._mac = applyTemplate(options.mac, idx);

    this._manufacturer = options.manufacturer || "BrByte";
    this._rootName = options.rootName || "Device"; // Default to TR-098 as per user hint
    this._oui = applyTemplate(options.oui || "FFFFFF", idx);
    this._productClass = options.productClass || "Simulator";
    this._serialNumber = applyTemplate(options.serialNumber || "123456", idx);

    // Determine structures based on Root Type
    // Determine structures based on Root Type
    if (this._rootName === "InternetGatewayDevice") {
      this._rootTree = this.defaultTR98();
    } else {
      this._rootTree = this.defaultTR181();
    }

    // The parameter tree + structural ops live in CwmpParams; mutations report
    // back here so the device's event bus (honoring _keepEvents) delivers them.
    this._params = new CwmpParams(
      this._rootTree,
      (event, path, data) => {
        if (!this._keepEvents) this.fireEvent(event, path, data);
      },
      this._log
    );

    const loadJSON = async () => {
      // Load an optional JSON data-model fixture to overlay on the default tree.
      const jsonFile = this._jsonPath;
      if (!jsonFile) return;
      try {
        const data = await fs.readFile(jsonFile);
        if (!data) return;
        const model = JSON.parse(data.toString());
        if (!model) return;
        if (!model[this._rootName]) return;
        // this._rootTree[this._rootName] = models.merge(this._rootTree[this._rootName], );
        this._rootTree[this._rootName] = convertObjectToCwmp(model[this._rootName], {
          defaultWritable: true
          // writableKeys: new Set(['DiagnosticsState', 'DownloadURL', 'UploadURL', 'TestFileLength'])
        });
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          this._log.debug(`JSON model file not found, using defaults: ${jsonFile}`);
        } else {
          this._log.warn(`Error loading JSON file '${jsonFile}': ${e}`);
        }
      }
    };
    loadJSON();

    // Internal State Flags
    this._pendingReboot = false;
    this._pendingFactoryReset = false;

    // Listeners Map: Path -> Set of callbacks
    this.listeners = new Map();

    this._diag = {
      ping: new DiagPing(this),
      traceroute: new DiagTraceroute(this),
      download: new DiagDownload(this),
      upload: new DiagUpload(this),
      wifi: new DiagWifi(this)
    };

    this.applyMac();
  }

  /**
   * Injects the configured MAC address into the data model's MACAddress leaf,
   * where one exists for the active root.
   */
  applyMac(): void {
    if (!this._mac) return;
    const macPaths =
      this._rootName === "InternetGatewayDevice"
        ? ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress"]
        : ["Device.Ethernet.Interface.1.MACAddress"];
    for (const path of macPaths) {
      const node = this.findNode(path);
      if (node && (node as any)._value !== undefined) this.set(path, this._mac, true);
    }
  }

  /**
   * Configures the ManagementServer ACS URL + credentials and the Connection
   * Request credentials in the data model. The device owns these parameters
   * (single source of truth), so callers no longer poke the parameter tree.
   */
  configureManagementServer(cfg: {
    acsUrl?: string;
    acsUser?: string;
    acsPass?: string;
    crUser?: string;
    crPass?: string;
  }): void {
    const ms = `${this._rootName}.ManagementServer`;
    const apply = (leaf: string, value?: string) => {
      if (value === undefined) return;
      if (this.findNode(`${ms}.${leaf}`)) this.set(`${ms}.${leaf}`, value, true);
    };
    apply("URL", cfg.acsUrl);
    apply("Username", cfg.acsUser);
    apply("Password", cfg.acsPass);
    apply("ConnectionRequestUsername", cfg.crUser);
    apply("ConnectionRequestPassword", cfg.crPass);
  }

  /**
   * Sets the Connection Request URL (assigned once the CR server binds).
   * @param {string} url - The full CR URL advertised to the ACS.
   */
  setConnectionRequestURL(url: string): void {
    const path = `${this._rootName}.ManagementServer.ConnectionRequestURL`;
    if (this.findNode(path)) this.set(path, url, true);
  }

  /**
   * Returns the device's current Connection Request credentials — the source of
   * truth for authenticating incoming connection requests.
   * @returns {{ user: string, pass: string }}
   */
  getCrCredentials(): { user: string; pass: string } {
    const ms = `${this._rootName}.ManagementServer`;
    return {
      user: this.getValue(`${ms}.ConnectionRequestUsername`),
      pass: this.getValue(`${ms}.ConnectionRequestPassword`)
    };
  }

  /**
   * The device's Connection Request URL path segment (a hash of its serial).
   * Cached after first use — the serial is fixed once the device is built.
   * @returns {string}
   */
  getConnectionHash(): string {
    return (this._connHash ??= hashConnectionPath(this._serialNumber));
  }

  // --- CWMP session (outbound: the CPE talks to the ACS) ---

  /**
   * Starts the device's CWMP activity: lazily builds the ACS HTTP client from
   * the device's own ManagementServer params and sends the initial inform.
   * @param {string} event - The boot event (default "1 BOOT").
   */
  start(event: string = "1 BOOT") {
    if (!this._httpClient) {
      const ms = `${this._rootName}.ManagementServer`;
      this._httpClient = new CwmpHttp({
        method: "POST",
        uri: this.getValue(`${ms}.URL`),
        username: this.getValue(`${ms}.Username`),
        password: this.getValue(`${ms}.Password`),
        logger: this._log,
      });
      // A completed diagnostic/transfer schedules a follow-up inform.
      this.addListener("sessionInform", (val: string) => {
        this.setPeriodicInform(val, 1000);
        this._periodicInformDisabled = true;
      });
    }
    this.startSession(event);
  }

  /**
   * Triggered by the Connection Request server when the ACS pokes this device.
   * @param {string} event - Event code (default "6 CONNECTION REQUEST").
   */
  onConnectionRequest(event: string = "6 CONNECTION REQUEST") {
    this.startSession(event);
  }

  /**
   * Stops the device: clears the periodic-inform timer and tears down the client.
   */
  stop() {
    if (this._periodicInformTimeout) clearTimeout(this._periodicInformTimeout);
    this._periodicInformTimeout = null;
    if (this._httpClient) {
      this._httpClient.finish();
      this._httpClient = null;
    }
  }

  /**
   * Initiates a CWMP session with the ACS.
   * @param {string} event - The event code (e.g., "1 BOOT", "2 PERIODIC").
   */
  async startSession(event: string = "2 PERIODIC") {
    this._requestId = Math.random().toString(36).slice(-8);
    this._periodicInformDisabled = false;
    const sn = this.getValue(`${this._rootName}.DeviceInfo.SerialNumber`);
    this._log.info(`[${sn}] Starting session with event: ${event}`);

    try {
      let body = methods.Inform(this, event);
      let xml = soap.createSoapDocument(this._requestId, body);
      let responseXml = await this.sendRequest(xml);
      await this.handleMethod(responseXml);
    } catch (e) {
      this._log.error("Session internal failure: ", e);
    }
  }

  /**
   * Schedules the next periodic inform.
   * @param {string} event - Event code.
   * @param {number} interval - Interval in ms (default: this._periodicInformInterval).
   */
  setPeriodicInform(event: string = "2 PERIODIC", interval: number = 0) {
    if (this._periodicInformDisabled) return;
    if (this._periodicInformTimeout) clearTimeout(this._periodicInformTimeout);

    let periodicInformInterval = interval || this._periodicInformInterval;
    if (!periodicInformInterval || periodicInformInterval < 0) periodicInformInterval = 3000;

    this._periodicInformTimeout = setTimeout(this.startSession.bind(this, event), periodicInformInterval);
  }

  /**
   * Sends a SOAP request to the ACS and handles reboot / factory-reset / end-of-session.
   * @param {string} xml - The SOAP XML body.
   */
  async sendRequest(xml: string): Promise<null | string> {
    this._log.trace("→ ACS\n" + xml);
    const body = await this._httpClient.sendRequest(xml);
    this._log.trace("← ACS\n" + (body && body.length ? body : "(empty / 204)"));

    if (this._pendingReboot) {
      this._log.info("Rebooting in 5 seconds...");
      setTimeout(() => {
        this._pendingReboot = false;
        this._log.info("Device rebooted.");
        this.startSession("1 BOOT,M Reboot");
      }, 5000);
      return null;
    }

    if (this._pendingFactoryReset) {
      this._log.info("Factory Resetting in 5 seconds...");
      setTimeout(() => {
        this._pendingFactoryReset = false;
        this._log.info("Device Reset.");
        this.startSession("1 BOOT");
      }, 5000);
      return null;
    }

    if (!body) {
      this.setPeriodicInform();
      return null;
    }

    return body;
  }

  /**
   * Handles an ACS response: dispatches the RPC and continues the session loop.
   * @param {string} body - The response body string.
   */
  async handleMethod(body: string): Promise<null> {
    if (!body) {
      this._log.debug("Empty response from ACS (End of Session)");
      this.setPeriodicInform();
      return null;
    }
    let xmlObj = body ? xmlParser.parseXml(body) : null;
    let [rId, bodyElement] = soap.getRequestIdAndBody(xmlObj);
    this._requestId = rId; // Update ID for response

    let requestElement = bodyElement.children[0];
    let requestXml: string = "";
    let responseXml: null | string = null;

    if (!requestElement) {
      this._log.debug("No recognizable element in Body.");
      responseXml = await this.sendRequest("");
      await this.handleMethod(responseXml);
      return null;
    }

    let methodName = requestElement.localName;
    const method = methods[methodName];
    this._log.info(`Received: ${methodName}`);

    if (!method) {
      this._log.warn(`Method ${methodName} not supported.`);
      requestXml = soap.createFaultResponse(this._requestId, 9000, "Method not supported.");
      responseXml = await this.sendRequest(requestXml);
      return this.handleMethod(responseXml);
    }
    let responseBody = method(this, requestElement);
    requestXml = soap.createSoapDocument(this._requestId, responseBody);
    responseXml = await this.sendRequest(requestXml);
    await this.handleMethod(responseXml);
    return;
  }

  /**
   * Sets the last executed method name.
   * @param {string} method - The method name.
   */
  setLastMethod(method: string = "Inform"): void {
    this._lastMethod = method;
  }

  /**
   * Finishes a task and triggers the appropriate event (e.g. transfer complete).
   * @param {CWMPTask} task - The task to finish.
   */
  finishTask(task: CWMPTask) {
    if (!task) return;
    task._isRequested = false;
    task._isRunning = false;
    switch (task._type) {
      case "diag-download":
      case "diag-upload":
      case "diag-ping":
      case "diag-traceroute":
      case "diag-wifi":
        this.fireEvent("taskFinished", "sessionInform", "8 DIAGNOSTICS COMPLETE");
        break;
      case "task-download":
        this.fireEvent("taskFinished", "sessionInform", "7 TRANSFER COMPLETE,M Download");
        break;
      case "task-upload":
        this.fireEvent("taskFinished", "sessionInform", "7 TRANSFER COMPLETE,M Upload");
        break;
      default:
        break;
    }
  }

  /**
   * Adds a task to the pending queue.
   * @param {CWMPTask} task - The task to add.
   */
  addTask(task: CWMPTask) {
    this._pendingTask.push(task);
    if (!this._pendingTimeout) {
      this._pendingTimeout = setTimeout(() => this.runTask(), 1000);
    }
  }

  /**
   * Runs the next pending task in the queue.
   * Manages task execution lifecycle and timeouts.
   */
  runTask() {
    this._pendingTimeout = null;
    if (this._pendingTask.length === 0) return;

    const task = this._pendingTask[0];

    if (task._timeoutId) {
      this._log.debug(`Task [${task._type}] timeout`, task._timeoutId);
      this._pendingTimeout = setTimeout(() => this.runTask(), 1000);
      return;
    }

    if (task._isRunning) {
      this._log.debug(`Task [${task._type}] running`, task._isRunning);
      this._pendingTimeout = setTimeout(() => this.runTask(), 500);
      return;
    }

    if (task._isRequested) {
      this._log.debug(`Task [${task._type}] going to run`);
      task.run();
      this._pendingTimeout = setTimeout(() => this.runTask(), 1000);
      return;
    }

    this._log.debug(`Task [${task._type}] finished`);
    // Not running and not requested means it finished (or was never valid)
    this._pendingTask.shift();
    this._pendingTimeout = setTimeout(() => this.runTask(), 1000);
  }

  /**
   * Adds a message to the pending message queue.
   * @param {Function} fn - The message function to add.
   */
  addMessage(fn: Function) {
    this._pendingMessages.push(fn);
  }

  /**
   * Retrieves all pending messages.
   * @returns {Function[]} List of message functions.
   */
  getMessages(): Function[] {
    return this._pendingMessages;
  }

  /**
   * Retrieves and removes the next message from the queue.
   * @returns {Function|null} The next message function or null.
   */
  getNextMessage() {
    if (!this._pendingMessages || this._pendingMessages.length === 0) return null;
    this._log.debug("Get Next Message", this._pendingMessages.length);
    return this._pendingMessages.shift();
  }

  /**
   * Navigates the parameter tree to find a node.
   * @param {string} path - The full parameter path.
   * @param {boolean} create - Whether to create missing nodes (for partial object creation).
   * @returns {CwmpNode|null} The found node or null.
   */
  findNode(path: string | null, create?: boolean): CwmpNode | null {
    return this._params.findNode(path, create);
  }

  /**
   * Retrieves a parameter node.
   * @param {string} path - The parameter path.
   * @returns {CwmpNode|null} The found node or null.
   */
  get(path: string | null): CwmpNode | null {
    return this._params.get(path);
  }

  /**
   * Retrieves the value of a parameter directly.
   * @param {string} path - The parameter path.
   * @returns {string} The value or empty string if not found.
   */
  getValue(path: string | null): string {
    return this._params.getValue(path);
  }

  /**
   * Sets the value of a parameter and triggers listeners.
   * @param {string} path - The parameter path.
   * @param {string} value - The new value.
   * @returns {boolean} True if successful, false otherwise.
   */
  set(path: string | null, value: string, force?: boolean): boolean {
    return this._params.set(path, value, force);
  }

  /**
   * Retrieves parameter names and attributes under a given path.
   * @param {string} parameterPath - The root path to search.
   * @param {boolean} nextLevel - If true, only returns immediate children.
   * @returns {Array} List of {name, writable} objects.
   */
  getParameterNames(parameterPath: string | null, nextLevel: boolean): Array<{ name: string; writable: boolean }> {
    return this._params.getParameterNames(parameterPath, nextLevel);
  }

  /**
   * Adds a new object instance to the tree.
   * @param {string} path - The object path (ending in dot).
   * @returns {Array} [Status, InstanceNumber]
   */
  addObject(path: string | null): [number, number] {
    return this._params.addObject(path);
  }

  /**
   * Deletes an object instance from the tree.
   * @param {string} path - The full path to the object instance.
   * @returns {number} Status code (0 for success).
   */
  deleteObject(path: string | null): number {
    return this._params.deleteObject(path);
  }

  /**
   * Registers a callback for a parameter change.
   * @param {string} path - Parameter path.
   * @param {Function} callback - Function called with new value.
   */
  addListener(path: string, callback: Function) {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path).add(callback);
  }

  /**
   * Removes a registered listener.
   * @param {string} path - Parameter path.
   * @param {Function} callback - The callback to remove.
   */
  removeListener(path: string, callback: Function) {
    if (this.listeners.has(path)) {
      this.listeners.get(path).delete(callback);
    }
  }

  /**
   * Fires all listeners for a given path.
   * @param {string} path - Parameter path.
   * @param {any} data - Data to pass to callbacks (usually new value).
   */
  fireEvent(event: string, path: string, data: any) {
    if (this.listeners.has(path)) {
      this.listeners.get(path).forEach((callback) => callback(data));
    }
  }

  /**
   * Retrieves all leaf nodes under a given path.
   * Useful for partial path requests (e.g. "Device.").
   * @param {string} path - The root path to search.
   * @returns {Array} List of {name, value, type, writable} objects.
   */
  getLeaves(path: string): Array<{ name: string; value: string; type: string; writable: boolean }> {
    return this._params.getLeaves(path);
  }

  /**
   * Registers a data model for the creation of new objects.
   * @param {string} path - The object path (e.g., "Device.NAT.PortMapping.").
   * @param {object} internalModel - The internal model structure.
   */
  setObjectModel(path: string, internalModel: object) {
    this._params.setObjectModel(path, internalModel);
  }
  /**
   * Generates the TR-098 InternetGatewayDevice structure.
   * @returns {object} Root object
   */
  defaultTR98(): object {
    const root = {
      InternetGatewayDevice: {
        _writable: false,
        DeviceInfo: models.merge(models.commonDeviceInfoParams, {
          Manufacturer: { _value: this._manufacturer, _type: "xsd:string", _writable: false },
          ManufacturerOUI: { _value: this._oui, _type: "xsd:string", _writable: false },
          ProductClass: { _value: this._productClass, _type: "xsd:string", _writable: false },
          SerialNumber: { _value: this._serialNumber, _type: "xsd:string", _writable: false }
        }),
        ManagementServer: models.merge(models.commonManagementServerParams, {
          _writable: false,
          Username: { _value: "", _type: "xsd:string", _writable: true },
          Password: { _value: "", _type: "xsd:string", _writable: true },
          ConnectionRequestUsername: { _value: "", _type: "xsd:string", _writable: true },
          ConnectionRequestPassword: { _value: "", _type: "xsd:string", _writable: true },
          ConnectionRequestURL: { _value: "", _type: "xsd:string", _writable: false }
        }),
        IPPingDiagnostics: models.merge(models.ipPingDiagnosticsParams, {}),
        TraceRouteDiagnostics: models.merge(models.traceRouteDiagnosticsParams, {}),
        DownloadDiagnostics: models.merge(models.downloadDiagnosticsParams, {}),
        UploadDiagnostics: models.merge(models.uploadDiagnosticsParams, {}),
        WANDevice: {
          _writable: false,
          "1": {
            _writable: false,
            WANConnectionDevice: {
              _writable: false,
              "1": {
                _writable: false,
                WANIPConnection: {
                  _writable: false,
                  "1": models.merge(models.wanIPConnectionDeviceParams, {})
                }
              }
            }
          }
        },
        LANDevice: {
          _writable: false,
          "1": {
            _writable: false,
            WLANConfiguration: {
              "1": models.merge(models.wlanConfigurationParams, { _writable: false })
            }
          }
        }
      }
    };

    return root;
  }

  /**
   * Generates the TR-181 Device structure.
   * @returns {object} Root object
   */
  defaultTR181(): object {
    const root = {
      Device: {
        _writable: false,
        DeviceInfo: models.merge(models.commonDeviceInfoParams, {
          _writable: false,
          Manufacturer: { _value: this._manufacturer, _type: "xsd:string", _writable: false },
          ManufacturerOUI: { _value: this._oui, _type: "xsd:string", _writable: false },
          ProductClass: { _value: this._productClass, _type: "xsd:string", _writable: false },
          SerialNumber: { _value: this._serialNumber, _type: "xsd:string", _writable: false }
        }),
        ManagementServer: models.merge(models.commonManagementServerParams, {
          _writable: false,
          Username: { _value: "", _type: "xsd:string", _writable: true },
          Password: { _value: "", _type: "xsd:string", _writable: true },
          ConnectionRequestUsername: { _value: "", _type: "xsd:string", _writable: true },
          ConnectionRequestPassword: { _value: "", _type: "xsd:string", _writable: true },
          ConnectionRequestURL: { _value: "", _type: "xsd:string", _writable: false }
        }),
        IP: {
          _writable: false,
          Diagnostics: {
            _writable: false,
            IPPing: models.merge(models.ipPingDiagnosticsParams, {}),
            TraceRoute: models.merge(models.traceRouteDiagnosticsParams, {}),
            DownloadDiagnostics: models.merge(models.downloadDiagnosticsParams, {}),
            UploadDiagnostics: models.merge(models.uploadDiagnosticsParams, {})
          }
        },
        LANDevice: {
          _writable: false,
          1: {
            _writable: false,
            WLANConfiguration: {
              "1": models.merge(models.wlanConfigurationParams, { _writable: false })
            }
          }
        }
      }
    };

    return root;
  }

  /**
   * Generates structure from CSV (Placeholder/Proxy).
   * @returns {object} Root object
   */
  defaultCSV(): object {
    // For now, proxy to TR-098 or TR-181 based on type
    if (this._rootName === "InternetGatewayDevice") {
      return this.defaultTR98();
    }
    return this.defaultTR181();
  }

  exportCSV(path: string) {
    this._log.info(`Mock exporting CSV to ${path}`);
  }
}
