"use strict";

import xmlParser from "./xml-parser.ts";

function node(key: string, attrs = {}, value: string | string[] = "") {
  if (!key) return;
  if (Array.isArray(value)) value = value.join("");
  let attrsStr = "";
  for (const [k, v] of Object.entries(attrs)) attrsStr += ` ${k}="${v}"`;
  if (!value) return `<${key}${attrsStr}/>`
  return `<${key}${attrsStr}>${value}</${key}>`
}
/**
 * Creates a SOAP Fault response
 * @param faultCode - TR-069 fault code (e.g., 9003, 9010)
 * @param faultString - Human-readable fault description
 * @param detail - Additional fault details
 * @returns SOAP Fault XML string
 */
function fault(faultCode: number, faultString: string, detail: string = "") {
  const faultCodeString = `Client`;

  let detailNode = "";
  if (detail) {
    detailNode = node("detail", {},
      node("cwmp:Fault", {}, [
        node("FaultCode", {}, String(faultCode)),
        node("FaultString", {}, detail)
      ])
    );
  }

  return node("soap:Fault", {}, [
    node("faultcode", {}, faultCodeString),
    node("faultstring", {}, faultString),
    detailNode
  ]);
}

function simpleFault(code: number, message: string) {
  return node("soap-env:Fault", {}, [
    node("FaultCode", {}, code.toString()),
    node("FaultString", {}, xmlParser.encodeEntities(message))
  ]);
}

export default {
  node,
  fault,
  simpleFault
};
