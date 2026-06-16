"use strict";

import CWMPDevice from "./cwmp-device.ts";
import CWMPConn from "./cwmp-conn.ts";
import type { ConnectionRequest } from "./cwmp-conn.ts";
import type { CwmpSimulatorOptions } from "./types.ts";
import { createLogger, NULL_LOGGER, type Logger } from "./logger.ts";

/**
 * Orchestrates a simulated CPE: owns the device and the Connection Request
 * server, and routes incoming connection requests to the device's session.
 * The device itself runs the CWMP session (Inform loop) with the ACS.
 */
export default class CWMPSimulator {
  _device!: CWMPDevice;
  _connectRequestServer: CWMPConn | null = null;
  _options: CwmpSimulatorOptions;
  _log: Logger = NULL_LOGGER;

  /**
   * Creates a new Simulator instance.
   * @param {object} options - Configuration options.
   */
  constructor(options: CwmpSimulatorOptions) {
    this._options = { ...options };

    // Per-instance logger: a consumer-supplied logger wins; otherwise build the
    // built-in one from options.log. With no options.log the logger is silent.
    this._log = options.log?.logger
      ?? createLogger({ level: options.log?.level, prefix: options.log?.prefix, sink: options.log?.sink });

    this._device = new CWMPDevice({ ...options.device, logger: this._log });
    this._device.configureManagementServer({
      acsUrl: options.acs.url,
      acsUser: options.acs.user,
      acsPass: options.acs.pass,
      crUser: options.conn.user,
      crPass: options.conn.pass,
    });

    // Keep the CR server's credentials aligned if the ACS rewrites them via SPV.
    const r = this._device._rootName;
    this._device.addListener(`${r}.ManagementServer.ConnectionRequestUsername`, (val) => {
      this._log.debug(`ConnectionRequestUsername changed to [${val}]`);
      this._options.conn.user = val;
    });
    this._device.addListener(`${r}.ManagementServer.ConnectionRequestPassword`, (val) => {
      this._log.debug(`ConnectionRequestPassword changed to [${val}]`);
      this._options.conn.pass = val;
    });
  }

  /**
   * Starts the Connection Request server, then boots the device's CWMP session.
   */
  start() {
    if (this._connectRequestServer) {
      this._device.start();
      return this._connectRequestServer;
    }
    this._connectRequestServer = new CWMPConn(this._options.acs.url, this._options.conn, this._log);
    this._connectRequestServer.listenHTTP((event: string) => {
      this._device.onConnectionRequest(event);
    }).then((connection: ConnectionRequest) => {
      this._device.setConnectionRequestURL(connection.url);
      this._log.info(`Connection server started on ${connection.url}`);
      this._device.start();
    }).catch((err: Error) => {
      this._log.error(`Failed to start connection server: ${err.message}`);
    });
  }

  /**
   * Stops the device session and closes the Connection Request server.
   */
  stop() {
    this._device.stop();
    if (this._connectRequestServer?._server) {
      this._connectRequestServer._server.close();
    }
  }
}
