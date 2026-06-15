"use strict";

import models from "./cwmp-model.ts";
import fs from "node:fs/promises";
import type { CwmpNode, CwmpDeviceOptions } from './types.ts';
import DiagPing from "./diag-ping.ts";
import DiagTraceroute from "./diag-traceroute.ts";
import DiagDownload from "./diag-download.ts";
import DiagUpload from "./diag-upload.ts";
import DiagWifi from "./diag-wifi.ts";
import CWMPTask from "./cwmp-task.ts";
import { NULL_LOGGER, type Logger } from "./logger.ts";

function inferXsdType(value: any): string {
  if (typeof value === 'boolean') return 'xsd:boolean';
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? 'xsd:int'
      : 'xsd:float';
  }
  return 'xsd:string';
}

function convertObjectToCwmp(
  input: Record<string, any>,
  options?: {
    writableKeys?: Set<string>;
    defaultWritable?: boolean;
  }
): Record<string, any> {
  const internal: Record<string, any> = {};

  for (const [key, value] of Object.entries(input)) {
    // recurse
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      internal[key] = convertObjectToCwmp(value, options);
      continue;
    }

    const writable =
      options?.writableKeys?.has(key) ??
      options?.defaultWritable ??
      false;

    internal[key] = {
      _value: value === null ? '' : String(value),
      _type: inferXsdType(value),
      _writable: writable
    };
  }

  return internal;
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
  _rootName: string = "Device";
  _rootTree: any;
  _keepEvents = false;
  listeners: Map<string, Set<Function>>;
  objectModels: Map<string, any>;
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

    this._manufacturer = options.manufacturer || "BrByte";
    this._rootName = options.rootName || "Device"; // Default to TR-098 as per user hint
    this._oui = options.oui || "FFFFFF";
    this._productClass = options.productClass || "Simulator";
    this._serialNumber = options.serialNumber || "123456";

    // Determine structures based on Root Type
    // Determine structures based on Root Type
    if (this._rootName === "InternetGatewayDevice") {
      this._rootTree = this.defaultTR98();
    } else {
      this._rootTree = this.defaultTR181();
    }

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
          defaultWritable: true,
          // writableKeys: new Set(['DiagnosticsState', 'DownloadURL', 'UploadURL', 'TestFileLength'])
        });
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          this._log.debug(`JSON model file not found, using defaults: ${jsonFile}`);
        } else {
          this._log.warn(`Error loading JSON file '${jsonFile}': ${e}`);
        }
      }
    }
    loadJSON();

    // Internal State Flags
    this._pendingReboot = false;
    this._pendingFactoryReset = false;

    // Listeners Map: Path -> Set of callbacks
    this.listeners = new Map();

    // Object Models Map: Path Pattern -> Model Definition (Internal)
    this.objectModels = new Map();

    this._diag = {
      'ping': new DiagPing(this),
      'traceroute': new DiagTraceroute(this),
      'download': new DiagDownload(this),
      'upload': new DiagUpload(this),
      'wifi': new DiagWifi(this),
    };
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
  getMessages() {
    return this._pendingMessages;
  }

  /**
   * Retrieves and removes the next message from the queue.
   * @returns {Function|null} The next message function or null.
   */
  getNextMessage() {
    if (!this._pendingMessages || this._pendingMessages.length === 0) return null;
    this._log.debug('Get Next Message', this._pendingMessages.length);
    return this._pendingMessages.shift();
  }

  /**
   * Navigates the parameter tree to find a node.
   * @param {string} path - The full parameter path.
   * @param {boolean} create - Whether to create missing nodes (for partial object creation).
   * @returns {CwmpNode|null} The found node or null.
   */
  findNode(path: string | null, create?: boolean): CwmpNode | null {
    if (!path) return null;
    const parts = path.split('.');
    let current = this._rootTree;
    for (const part of parts) {
      if (part === "") continue;
      if (!current[part]) {
        if (create) current[part] = { _writable: true };
        else return null;
      }
      current = current[part];
    }
    return current;
  }

  /**
   * Retrieves a parameter node.
   * @param {string} path - The parameter path.
   * @returns {CwmpNode|null} The found node or null.
   */
  get(path: string | null): CwmpNode | null {
    const node = this.findNode(path);
    if (node && node._value !== undefined) {
      return node;
    }
    return null;
  }

  /**
   * Retrieves the value of a parameter directly.
   * @param {string} path - The parameter path.
   * @returns {string} The value or empty string if not found.
   */
  getValue(path: string | null): string {
    const node = this.findNode(path);
    return (node && node._value !== undefined) ? node._value : "";
  }

  /**
   * Sets the value of a parameter and triggers listeners.
   * @param {string} path - The parameter path.
   * @param {string} value - The new value.
   * @returns {boolean} True if successful, false otherwise.
   */
  set(path: string | null, value: string, force?: boolean): boolean {
    const node = this.findNode(path, force);
    if (node && (force || node._value !== undefined)) {
      if (node._writable || force) {
        node._value = value;
        this._log.debug(`Set ${path} to ${value}`);
        if (typeof node.funcSet === 'function') {
          node.funcSet();
        }
        if (this._keepEvents) return true;
        this.fireEvent('set', path, value);
        return true;
      }
    }
    return false;
  }

  /**
   * Retrieves parameter names and attributes under a given path.
   * @param {string} parameterPath - The root path to search.
   * @param {boolean} nextLevel - If true, only returns immediate children.
   * @returns {Array} List of {name, writable} objects.
   */
  getParameterNames(parameterPath: string | null, nextLevel: boolean) {
    const node = this.findNode(parameterPath);
    if (!node) return [];

    let results = [];
    const prefix = parameterPath?.endsWith('.') || parameterPath === "" ? parameterPath : parameterPath + ".";

    if (node._value !== undefined) {
      // It's a leaf
      return [{ name: parameterPath, writable: node._writable }];
    }

    for (const key in node) {
      if (key.startsWith("_")) continue;
      const childPath = prefix + key;
      const child = node[key];

      if (child._value !== undefined) {
        results.push({ name: childPath, writable: child._writable });
      } else {
        if (nextLevel) {
          results.push({ name: childPath + ".", writable: child._writable || false });
        } else {
          results = results.concat(this.getParameterNames(childPath, false));
        }
      }
    }
    return results;
  }

  /**
   * Adds a new object instance to the tree.
   * @param {string} path - The object path (ending in dot).
   * @returns {Array} [Status, InstanceNumber]
   */
  addObject(path: string | null) {
    if (!path) return [9005, 0];
    // Path should end with "."? TR-069 says AddObject(ObjectName) where ObjectName ends in .
    if (path.endsWith(".")) path = path.slice(0, -1);

    // Generic Fallback
    const parentNode = this.findNode(path);
    if (!parentNode) return [9005, 0];

    // Calculate new instance ID
    let maxInstance = 0;
    for (const key in parentNode) {
      if (key.startsWith("_")) continue;
      if (!isNaN(parseInt(key))) {
        const instance = parseInt(key);
        if (instance > maxInstance) maxInstance = instance;
      }
    }

    let newInstanceId = maxInstance + 1;
    parentNode[newInstanceId] = { _writable: true };
    if (typeof parentNode.funcObj == 'function') {
      parentNode[newInstanceId] = parentNode.funcObj(this, { _writable: true }, newInstanceId, parentNode);
    }

    // Attempt Generic NumberOfEntries Update
    const pathParts = path.split('.');
    const collectionName = pathParts.pop();
    const grandParentPath = pathParts.join('.');
    if (grandParentPath) {
      let numEntriesPath = `${grandParentPath}.${collectionName}NumberOfEntries`;
      let node = this.findNode(numEntriesPath);
      if (node) {
        let currentVal = parseInt(node._value || '0');
        node._value = String(currentVal + 1);
        // this.set(numEntriesPath, String(currentVal + 1));
        this.fireEvent('add', numEntriesPath, node._value);
      }
    }

    return [0, newInstanceId];
  }

  /**
   * Deletes an object instance from the tree.
   * @param {string} path - The full path to the object instance.
   * @returns {number} Status code (0 for success).
   */
  deleteObject(path: string | null): number {
    if (!path) return 1;
    if (path.endsWith(".")) path = path.slice(0, -1);

    const parts = path.split('.');
    const instancePart = parts.pop();
    const parentPath = parts.join('.');

    const parentNode = this.findNode(parentPath);
    if (!parentNode) return 1; // 9005

    if (!parentNode[instancePart]) return 1; // 9005 Invalid

    delete parentNode[instancePart];

    // Attempt Generic NumberOfEntries Update (Decrement)
    if (parentPath) {
      let collectionName = parentPath.split('.').pop() || ""; // Might normally be derived differently, but check 'addObject' logic
      // Actually 'parts' has parentPath. parentPath is "Device.X.PortMapping".
      // collectionName is "PortMapping".
      // grandParentPath would be "Device.X".
      // But here 'parts' was split from "Device.X.PortMapping.1" -> parentPath="Device.X.PortMapping", instancePart="1".
      // So parentPath is the collection path.

      const pathParts = parentPath.split('.');
      const collName = pathParts.pop();
      const gpPath = pathParts.join('.');

      if (gpPath) {
        let numEntriesPath = `${gpPath}.${collName}NumberOfEntries`;
        let node = this.findNode(numEntriesPath);
        if (node) {
          let currentVal = parseInt(node._value || '0');
          if (currentVal > 0) {
            node._value = String(currentVal - 1);
            this.fireEvent('set', numEntriesPath, node._value);
          }
        }
      }
    }

    return 0; // Success
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
      this.listeners.get(path).forEach(callback => callback(data));
    }
  }

  /**
   * Retrieves all leaf nodes under a given path.
   * Useful for partial path requests (e.g. "Device.").
   * @param {string} path - The root path to search.
   * @returns {Array} List of {name, value, type, writable} objects.
   */
  getLeaves(path: string): Array<{ name: string, value: string, type: string, writable: boolean }> {
    const node = this.findNode(path);
    if (!node) return [];

    let results = [];
    // If path is root or ends in dot, prefix is path.
    // If path is "Device", prefix is "Device."
    // Actually findNode handles the traversal.
    // If path is "Device.DeviceInfo", key is "Manufacturer". childPath should be "Device.DeviceInfo.Manufacturer".
    const prefix = path.endsWith('.') || path === "" ? path : path + ".";

    if (node._value !== undefined) {
      // It's a leaf
      return [{
        name: path,
        value: node._value,
        type: node._type,
        writable: node._writable
      }];
    }

    for (const key in node) {
      if (key.startsWith("_")) continue;
      const childPath = prefix + key;
      const child = node[key]; // This gets the object at that key

      // We need to pass the full path to recursive call
      // If we are at Device.DeviceInfo, keys are Manufacturer, etc.
      // Recursive call with Device.DeviceInfo.Manufacturer

      // Optimization: if child is leaf, push immediately
      if (child && child._value !== undefined) {
        results.push({
          name: childPath,
          value: child._value,
          type: child._type,
          writable: child._writable
        });
      } else {
        results = results.concat(this.getLeaves(childPath));
      }
    }
    return results;
  }

  /**
   * Registers a data model for the creation of new objects.
   * @param {string} path - The object path (e.g., "Device.NAT.PortMapping.").
   * @param {object} internalModel - The internal model structure.
   */
  setObjectModel(path: string, internalModel: object) {
    this.objectModels.set(path, internalModel);
  }
  /**
   * Generates the TR-098 InternetGatewayDevice structure.
   * @returns {object} Root object
   */
  defaultTR98(): object {
    const root = {
      'InternetGatewayDevice': {
        _writable: false,
        'DeviceInfo': models.merge(models.commonDeviceInfoParams, {
          'Manufacturer': { _value: this._manufacturer, _type: 'xsd:string', _writable: false },
          'ManufacturerOUI': { _value: this._oui, _type: 'xsd:string', _writable: false },
          'ProductClass': { _value: this._productClass, _type: 'xsd:string', _writable: false },
          'SerialNumber': { _value: this._serialNumber, _type: 'xsd:string', _writable: false },
        }),
        'ManagementServer': models.merge(models.commonManagementServerParams, {
          _writable: false,
          'Username': { _value: "", _type: 'xsd:string', _writable: true },
          'Password': { _value: "", _type: 'xsd:string', _writable: true },
          'ConnectionRequestUsername': { _value: "", _type: 'xsd:string', _writable: true },
          'ConnectionRequestPassword': { _value: "", _type: 'xsd:string', _writable: true },
          'ConnectionRequestURL': { _value: "", _type: 'xsd:string', _writable: false },
        }),
        'IPPingDiagnostics': models.merge(models.ipPingDiagnosticsParams, {}),
        'TraceRouteDiagnostics': models.merge(models.traceRouteDiagnosticsParams, {}),
        'DownloadDiagnostics': models.merge(models.downloadDiagnosticsParams, {}),
        'UploadDiagnostics': models.merge(models.uploadDiagnosticsParams, {}),
        'WANDevice': {
          _writable: false,
          '1': {
            _writable: false,
            'WANConnectionDevice': {
              _writable: false,
              '1': {
                _writable: false,
                'WANIPConnection': {
                  _writable: false,
                  '1': models.merge(models.wanIPConnectionDeviceParams, {})
                }
              }
            }
          }
        },
        'LANDevice': {
          _writable: false,
          '1': {
            _writable: false,
            'WLANConfiguration': {
              '1': models.merge(models.wlanConfigurationParams, { _writable: false })
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
      "Device": {
        _writable: false,
        DeviceInfo: models.merge(models.commonDeviceInfoParams, {
          _writable: false,
          'Manufacturer': { _value: this._manufacturer, _type: 'xsd:string', _writable: false },
          'ManufacturerOUI': { _value: this._oui, _type: 'xsd:string', _writable: false },
          'ProductClass': { _value: this._productClass, _type: 'xsd:string', _writable: false },
          'SerialNumber': { _value: this._serialNumber, _type: 'xsd:string', _writable: false },
        }),
        ManagementServer: models.merge(models.commonManagementServerParams, {
          _writable: false,
          'Username': { _value: "", _type: 'xsd:string', _writable: true },
          'Password': { _value: "", _type: 'xsd:string', _writable: true },
          'ConnectionRequestUsername': { _value: "", _type: 'xsd:string', _writable: true },
          'ConnectionRequestPassword': { _value: "", _type: 'xsd:string', _writable: true },
          'ConnectionRequestURL': { _value: "", _type: 'xsd:string', _writable: false },
        }),
        IP: {
          _writable: false,
          Diagnostics: {
            _writable: false,
            IPPing: models.merge(models.ipPingDiagnosticsParams, {}),
            TraceRoute: models.merge(models.traceRouteDiagnosticsParams, {}),
            DownloadDiagnostics: models.merge(models.downloadDiagnosticsParams, {}),
            UploadDiagnostics: models.merge(models.uploadDiagnosticsParams, {}),
          }
        },
        LANDevice: {
          _writable: false,
          1: {
            _writable: false,
            WLANConfiguration: {
              '1': models.merge(models.wlanConfigurationParams, { _writable: false })
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
