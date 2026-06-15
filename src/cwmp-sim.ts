"use strict";

import CWMPDevice from "./cwmp-device.ts";
import CWMPConn from "./cwmp-conn.ts";
import type { ConnectionRequest } from "./cwmp-conn.ts";
import methods from "./cwmp-methods.ts";
import soap from "./cwmp-soap.ts";
import xmlParser from "./xml-parser.ts";
import CwmpHttp from "./cwmp-http.ts";
import type { CwmpSimulatorOptions } from './types.ts';
import models from "./cwmp-model.ts";
import { createLogger, NULL_LOGGER, type Logger } from "./logger.ts";
/**
 * Orchestrates the simulated CPE.
 * Manages the Device, Connection Server, and Client Session state.
 */
export default class CWMPSimulator {
  _periodicInformTimeout: any = null;
  _periodicInformInterval = 30000;
  _periodicInformDisabled = false;
  _device!: CWMPDevice;
  _httpClient: CwmpHttp | null = null;
  _connectRequestServer: CWMPConn | null = null;
  _requestId: string | null = null;
  _options: CwmpSimulatorOptions;
  _log: Logger = NULL_LOGGER;

  /**
   * Creates a new Simulator instance.
   * @param {object} config - Configuration options.
   */
  constructor(options: CwmpSimulatorOptions) {
    this._options = {
      ...options,
    };

    // Per-instance logger: a consumer-supplied logger wins; otherwise build the
    // built-in one from options.log. With no options.log the logger is silent.
    this._log = options.log?.logger
      ?? createLogger({ level: options.log?.level, prefix: options.log?.prefix, sink: options.log?.sink });
    this._log.debug(`Starting CWMP Client with config: ${JSON.stringify(options, null, 2)}`);
    this._device = new CWMPDevice({ ...options.device, logger: this._log });
    this._httpClient = new CwmpHttp({
      method: 'POST',
      username: options.acs.user,
      password: options.acs.pass,
      uri: options.acs.url,
      logger: this._log,
    });

    // Listen for changes
    let r = this._device._rootName;
    this._device.addListener(`${r}.ManagementServer.ConnectionRequestUsername`, (val) => {
      this._log.debug(`ConnectionRequestUsername changed to [${val}]`);
      this._options.conn.user = val;
    });

    this._device.addListener(`${r}.ManagementServer.ConnectionRequestPassword`, (val) => {
      this._log.debug(`ConnectionRequestPassword changed to [${val}]`);
      this._options.conn.pass = val;
    });
    this._device.addListener(`sessionInform`, (val) => {
      this._log.debug(`Inform changed to ${val}`);
      this.setPeriodicInform(val, 1000);
      this._periodicInformDisabled = true;
    });

  }

  /**
   * Starts the simulator run loop.
   */
  start() {
    if (this._connectRequestServer) {
      this.startSession("1 BOOT");
      return this._connectRequestServer;
    }
    this._connectRequestServer = new CWMPConn(this._options.acs.url, this._options.conn, this._log);
    this._connectRequestServer.listenHTTP((event: string) => {
      this.startSession(event);
    }).then((connection: ConnectionRequest) => {
      const r = this._device._rootName;
      this._device._rootTree[r]['ManagementServer'] = models.merge(models.commonManagementServerParams, {
        _writable: false,
        'URL': { _value: this._options.acs.url, _type: 'xsd:string', _writable: true },
        'Username': { _value: this._options.acs.user, _type: 'xsd:string', _writable: true },
        'Password': { _value: this._options.acs.pass, _type: 'xsd:string', _writable: true },
        'ConnectionRequestUsername': { _value: this._options.conn.user, _type: 'xsd:string', _writable: true },
        'ConnectionRequestPassword': { _value: this._options.conn.pass, _type: 'xsd:string', _writable: true },
        'ConnectionRequestURL': { _value: connection.url, _type: 'xsd:string', _writable: false },
      })

      this._log.info(`Connection server started on ${connection.url}`);
      this.startSession("1 BOOT");
    }).catch((err: Error) => {
      this._log.error(`Failed to start connection server: ${err.message}`);
    })
  }

  /**
   * Initiates a CWMP session with the ACS.
   * @param {string} event - The event code (e.g., "1 BOOT", "2 PERIODIC").
   */
  async startSession(event: string = "2 PERIODIC") {
    this._requestId = Math.random().toString(36).slice(-8);
    this._periodicInformDisabled = false;
    const sn = this._device.getValue(`${this._device._rootName}.DeviceInfo.SerialNumber`);
    this._log.info(`[${sn}] Starting session with event: ${event}`);

    try {
      let body = methods.Inform(this._device, event);
      let xml = soap.createSoapDocument(this._requestId, body);
      let responseXml = await this.sendRequest(xml);
      // await this.cpeRequest();
      // this.handleMethod(body)
      await this.handleMethod(responseXml);
    } catch (e) {
      this._log.error('Simulator internal failure: ', e);
    }

    // methods.Inform(this._device, event, (informBody) => {
    //   let xml = soap.createSoapDocument(this._requestId, informBody);
    //   this.sendRequest(xml);
    // });
  }

  /**
   * Schedules the next periodic inform.
   * @param {string} event - Event code.
   * @param {number} interval - Interval in ms (default: 30000 if not set).
   */
  setPeriodicInform(event: string = "2 PERIODIC", interval: number = 0) {
    // if periodic inform is disabled, we don't put 'startSession()' in a timeout.
    if (this._periodicInformDisabled) return;

    // if there's a timeout already running, we'll stop it before setting another.
    if (this._periodicInformTimeout) clearTimeout(this._periodicInformTimeout);

    let periodicInformInterval = interval || this._periodicInformInterval;
    if (!periodicInformInterval || periodicInformInterval < 0)
      periodicInformInterval = 3000;

    this._periodicInformTimeout = setTimeout(this.startSession.bind(this, event), periodicInformInterval);

  }

  /**
   * Sends an HTTP request to the ACS.
   * @param {string} xml - The SOAP XML body.
   */
  async sendRequest(xml: string): Promise<null | string> {
    this._log.trace("→ ACS\n" + xml);
    const body = await this._httpClient.sendRequest(xml);
    this._log.trace("← ACS\n" + (body && body.length ? body : "(empty / 204)"));

    if (this._device._pendingReboot) {
      this._log.info("Rebooting in 5 seconds...");
      setTimeout(() => {
        this._device._pendingReboot = false;
        this._log.info("Device rebooted.");
        this.startSession("1 BOOT,M Reboot");
      }, 5000);
      return null;
    }

    if (this._device._pendingFactoryReset) {
      this._log.info("Factory Resetting in 5 seconds...");
      setTimeout(() => {
        this._device._pendingFactoryReset = false;
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
   * Handles the response from the ACS.
   * @param {string} body - The response body string.
   */
  async handleMethod(body: string): Promise<null> {
    if (!body) {
      this._log.debug("No body in response.");
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
    let responseBody = method(this._device, requestElement);
    requestXml = soap.createSoapDocument(this._requestId, responseBody);
    responseXml = await this.sendRequest(requestXml);
    await this.handleMethod(responseXml);
    return;
  }
}
