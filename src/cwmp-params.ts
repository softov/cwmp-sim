"use strict";

import type { CwmpNode } from "./types.ts";
import { NULL_LOGGER, type Logger } from "./logger.ts";

/** Reports a tree mutation; the owning device turns it into an event. */
export type ParamChangeHandler = (event: string, path: string, data: any) => void;

/**
 * Owns the CPE parameter tree and every structural operation on it:
 * navigation, read/write, object add/delete, and name/leaf enumeration.
 *
 * Mutating operations report through the injected `onChange` handler instead of
 * firing events directly — the owning `CWMPDevice` decides how (and whether,
 * via its `_keepEvents` flag) to deliver them to listeners.
 */
export default class CwmpParams {
  _rootTree: any;
  _log: Logger;
  _onChange: ParamChangeHandler;
  objectModels: Map<string, any> = new Map();

  constructor(rootTree: any, onChange: ParamChangeHandler = () => { }, logger: Logger = NULL_LOGGER) {
    this._rootTree = rootTree;
    this._onChange = onChange;
    this._log = logger;
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
   * Retrieves a parameter node (only if it is a leaf with a value).
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
   * Sets the value of a parameter and reports the change.
   * @param {string} path - The parameter path.
   * @param {string} value - The new value.
   * @param {boolean} force - Override read-only / create missing nodes.
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
        this._onChange('set', path as string, value);
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
  getParameterNames(parameterPath: string | null, nextLevel: boolean): Array<{ name: string, writable: boolean }> {
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
  addObject(path: string | null): [number, number] {
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
        this._onChange('add', numEntriesPath, node._value);
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
            this._onChange('set', numEntriesPath, node._value);
          }
        }
      }
    }

    return 0; // Success
  }

  /**
   * Retrieves all leaf nodes under a given path (supports partial paths).
   * @param {string} path - The root path to search.
   * @returns {Array} List of {name, value, type, writable} objects.
   */
  getLeaves(path: string): Array<{ name: string, value: string, type: string, writable: boolean }> {
    const node = this.findNode(path);
    if (!node) return [];

    let results = [];
    const prefix = path.endsWith('.') || path === "" ? path : path + ".";

    if (node._value !== undefined) {
      return [{ name: path, value: node._value, type: node._type, writable: node._writable }];
    }

    for (const key in node) {
      if (key.startsWith("_")) continue;
      const childPath = prefix + key;
      const child = node[key];

      if (child && child._value !== undefined) {
        results.push({ name: childPath, value: child._value, type: child._type, writable: child._writable });
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
}
