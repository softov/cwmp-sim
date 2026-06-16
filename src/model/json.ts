"use strict";

import type { LoadedModel } from "../types.ts";

/** Infers an `xsd:` type from a JS primitive (JSON models carry plain values). */
export function inferXsdType(value: any): string {
  if (typeof value === "boolean") return "xsd:boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "xsd:int" : "xsd:float";
  }
  return "xsd:string";
}

/**
 * Converts a plain nested object of values into the internal CWMP tree shape
 * (`{ _value, _type, _writable }` leaves). Used for JSON models and the
 * device's optional `DEVICE_JSON` overlay.
 *
 * JSON models are plain values only (no `_value/_type/_writable`); the rich
 * per-leaf metadata (writable, xsd type) lives in the CSV format.
 */
export function convertObjectToCwmp(
  input: Record<string, any>,
  options?: {
    writableKeys?: Set<string>;
    defaultWritable?: boolean;
  }
): Record<string, any> {
  const internal: Record<string, any> = {};

  for (const [key, value] of Object.entries(input)) {
    // recurse into nested containers
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      internal[key] = convertObjectToCwmp(value, options);
      continue;
    }

    const writable = options?.writableKeys?.has(key) ?? options?.defaultWritable ?? false;

    internal[key] = {
      _value: value === null ? "" : String(value),
      _type: inferXsdType(value),
      _writable: writable,
    };
  }

  return internal;
}

/**
 * Builds a model from a parsed JSON object of plain values. The root key is
 * inferred (prefers `Device` / `InternetGatewayDevice`); its subtree is
 * converted to the internal CWMP shape with writable leaves by default.
 */
export function jsonToTree(obj: Record<string, any>): LoadedModel {
  const keys = Object.keys(obj);
  const root = keys.find((k) => k === "Device" || k === "InternetGatewayDevice") ?? keys[0];
  if (!root) return { root: "Device", tree: {} };
  return { root, tree: { [root]: convertObjectToCwmp(obj[root], { defaultWritable: true }) } };
}
