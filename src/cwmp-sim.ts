"use strict";

import CWMPDevice from "./cwmp-device.ts";
import CWMPConn from "./cwmp-conn.ts";
import type { ConnectionRequest } from "./cwmp-conn.ts";
import type { CwmpSimulatorOptions } from "./types.ts";
import { createLogger, NULL_LOGGER, type Logger } from "./logger.ts";

/**
 * Orchestrates a fleet of simulated CPEs: builds N self-running devices and
 * fronts them with a single shared Connection Request server that routes by URL
 * path (`/{hash}`). Each device runs its own CWMP session with the ACS.
 * A single-device run is simply a fleet of one.
 */
export default class CWMPSimulator {
  _devices: CWMPDevice[] = [];
  _connectRequestServer: CWMPConn | null = null;
  _options: CwmpSimulatorOptions;
  _log: Logger = NULL_LOGGER;

  /** Back-compat accessor: the first device (single-device callers / CLI SIGINT). */
  get _device(): CWMPDevice {
    return this._devices[0];
  }

  /**
   * Creates a fleet of `fleet.count` devices (default 1), each with an
   * index-derived identity, configured against the ACS.
   * @param {object} options - Configuration options.
   */
  constructor(options: CwmpSimulatorOptions) {
    this._options = { ...options };

    // Per-instance logger: a consumer-supplied logger wins; otherwise build the
    // built-in one from options.log. With no options.log the logger is silent.
    this._log = options.log?.logger
      ?? createLogger({ level: options.log?.level, prefix: options.log?.prefix, sink: options.log?.sink });

    const count = Math.max(1, options.fleet?.count ?? 1);
    const baseIndex = options.device.index ?? 0;

    for (let i = 0; i < count; i++) {
      const device = new CWMPDevice({ ...options.device, index: baseIndex + i, logger: this._log });
      device.configureManagementServer({
        acsUrl: options.acs.url,
        acsUser: options.acs.user,
        acsPass: options.acs.pass,
        crUser: options.conn.user,
        crPass: options.conn.pass,
      });
      this._devices.push(device);
    }
  }

  /**
   * Starts the shared Connection Request server, then registers and boots each
   * device (staggered by `fleet.bootDelay`). Each device's CR URL is
   * `http://addr:port/{hash}` where hash is derived from its serial.
   */
  start() {
    const delay = this._options.fleet?.bootDelay ?? 1000;

    // Already listening — just (re)boot the devices.
    if (this._connectRequestServer) {
      this._devices.forEach((device, i) => setTimeout(() => device.start(), i * delay));
      return this._connectRequestServer;
    }

    const server = new CWMPConn(this._options.acs.url, this._options.conn, this._log);
    this._connectRequestServer = server;

    server.listenHTTP().then((connection: ConnectionRequest) => {
      this._devices.forEach((device, i) => {
        const hash = device.getConnectionHash();
        server.register(hash, {
          credentials: () => device.getCrCredentials(),
          onRequest: () => device.onConnectionRequest(),
        });
        device.setConnectionRequestURL(`${connection.url}${hash}`);
        setTimeout(() => device.start(), i * delay);
      });
    }).catch((err: Error) => {
      this._log.error(`Failed to start connection server: ${err.message}`);
    });

    return server;
  }

  /**
   * Stops every device session and closes the Connection Request server.
   */
  stop() {
    for (const device of this._devices) device.stop();
    if (this._connectRequestServer?._server) {
      this._connectRequestServer._server.close();
    }
  }
}
