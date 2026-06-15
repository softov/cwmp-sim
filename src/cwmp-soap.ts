"use strict";

import xmlUtils from "./xml-utils.ts";
import xmlParser from "./xml-parser.ts";
import type { XmlNode } from "./types.ts";

const NAMESPACES = {
  "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
  "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
  "xsd": "http://www.w3.org/2001/XMLSchema",
  "xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "cwmp": "urn:dslforum-org:cwmp-1-0"
};

function createSoapDocument(id: string, body: string) {
  if (!body) {
    // Empty Body means Empty Request (HTTP Post with no SOAP)
    return "";
  }

  let headerNode = xmlUtils.node(
    "soap-env:Header",
    {},
    xmlUtils.node("cwmp:ID", { "soap-env:mustUnderstand": 1 }, xmlParser.encodeEntities(id))
  );

  let bodyNode = xmlUtils.node("soap-env:Body", {}, body);
  let namespaces = {};
  for (let prefix in NAMESPACES)
    namespaces[`xmlns:${prefix}`] = NAMESPACES[prefix];

  let env = xmlUtils.node("soap-env:Envelope", namespaces, [headerNode, bodyNode]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${env}`;
}

function createFaultResponse(id: string, code: number, message: string) {
  let fault = xmlUtils.node(
    "detail",
    {},
    xmlUtils.node("cwmp:Fault", {}, [
      xmlUtils.node("FaultCode", {}, code.toString()),
      xmlUtils.node("FaultString", {}, xmlParser.encodeEntities(message))
    ])
  );

  let soapFault = xmlUtils.node("soap-env:Fault", {}, [
    xmlUtils.node("faultcode", {}, "Client"),
    xmlUtils.node("faultstring", {}, "CWMP fault"),
    fault
  ]);

  return createSoapDocument(id, soapFault);
}

function getRequestIdAndBody(xml: XmlNode | null): [string, XmlNode | null] {
  let headerElement: XmlNode | null = null, bodyElement: XmlNode | null = null;
  // If parsing raw string, we might need xmlParser.parseXml(xml) here?
  // But sim passes the parsed object usually? 
  // Code in sim: let xmlObj = xmlParser.parseXml(body); let [rId, bodyElement] = getRequestIdAndBody(xmlObj);
  // So xml is the object.

  if (!xml) return ["", null];

  let envelope = xml.children.find(c => c.localName === "Envelope") || xml.children[0];

  if (xml.localName === "root" && xml.children.length === 1) envelope = xml.children[0];

  for (const c of envelope.children) {
    if (c.localName === "Header") headerElement = c;
    else if (c.localName === "Body") bodyElement = c;
  }

  let rId = "";
  if (headerElement) {
    for (const c of headerElement.children) {
      if (c.localName === "ID") {
        rId = xmlParser.decodeEntities(c.text);
        break;
      }
    }
  }
  return [rId, bodyElement];
}

export default {
  createSoapDocument,
  createFaultResponse,
  getRequestIdAndBody
};
