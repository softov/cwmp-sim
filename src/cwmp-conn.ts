"use strict";

import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import type { CwmpConnOptions } from './types.ts';
import { NULL_LOGGER, type Logger } from './logger.ts';

function md5(data: string) {
  return crypto.createHash("md5").update(data).digest("hex");
}

export type ConnectionRequest = {
  ssl: boolean;
  addr: string;
  port: number;
  url: string;
}

/**
 * What a registered Connection Request path resolves to. The server is
 * device-agnostic: it asks the route for current credentials and notifies it on
 * an authenticated request — it never imports or inspects a device.
 */
export type CrRoute = {
  /** Current CR credentials (empty user/pass ⇒ no auth required). */
  credentials(): { user: string; pass: string };
  /** Invoked on an authenticated connection request. */
  onRequest(): void;
  /** Telemetry: a connection request was accepted for this route (after auth). */
  onReceived?(): void;
  /** Telemetry: a connection request failed auth (wrong credentials, not the initial challenge). */
  onAuthFail?(): void;
};

type HttpTransport = {
  createServer: typeof http.createServer;
  request: typeof http.request;
  Agent: typeof http.Agent;
};

/**
 * Shared Connection Request server (CPE side). Routes incoming requests by URL
 * path (`http://addr:port/{hash}`) to a registered device and authenticates with
 * that device's own Connection Request credentials. Supports Basic and Digest.
 */
export default class CWMPConn {
  _transport: HttpTransport = null;
  _options: CwmpConnOptions = null;
  _netConfig: net.NetConnectOpts = null;
  _server: http.Server | https.Server = null;
  _logVerbose = true;
  _log: Logger = NULL_LOGGER;
  /** hash path → route */
  _routes: Map<string, CrRoute> = new Map();

  /**
   * Creates a new connection request server.
   * @param {string} acsUrl - Used to detect the local egress IP to advertise.
   * @param {object} options - Connection options (bind addr/port, authMode).
   * @param {Logger} logger
   */
  constructor(acsUrl: string, options: CwmpConnOptions, logger: Logger = NULL_LOGGER) {
    this._log = logger;
    this._options = {
      authMode: 'Digest',
      addr: '0.0.0.0',
      port: 7547,
      ssl: false,
      ...options,
    };

    const parsedUrl = new URL(acsUrl);
    this._netConfig = {
      host: parsedUrl.hostname,
      port: parseInt(parsedUrl.port),
      family: 4,
    };

    this._server = null;
    this._transport = this._options.ssl ? https : http;
  }

  /**
   * Updates the configuration options.
   * @param {object} options - New options ({username, password, authMode}).
   */
  setOptions(options: CwmpConnOptions) {
    this._options = {
      ...this._options,
      ...options,
    };
    this._transport = this._options.ssl ? https : http;
  }

  /**
   * Registers a route under its CR URL hash path.
   * @param {string} hash - The path segment (e.g. device.getConnectionHash()).
   * @param {CrRoute} route - Credentials provider + request callback.
   */
  register(hash: string, route: CrRoute) {
    if (this._routes.has(hash)) {
      this._log.warn(`Connection Request path collision for hash '${hash}' — overwriting`);
    }
    this._routes.set(hash, route);
  }

  /** Removes a route from the routing table. */
  unregister(hash: string) {
    this._routes.delete(hash);
  }

  /**
   * Starts the HTTP server for connection requests. Routes by URL path to a
   * registered device. Resolves with the advertised base URL.
   * @returns {Promise<ConnectionRequest>}
   */
  async listenHTTP(): Promise<ConnectionRequest> {
    return new Promise((resolve, reject) => {
      let listenPort: number = this._options.port;
      let listenAddr = this._options.addr;
      // Start a dummy socket to discover the local egress IP to advertise.
      let socket = net.createConnection(this._netConfig)
        .on("error", reject)
        .on("connect", () => {
          // Use the discovered local egress address for the advertised URL, but
          // keep binding on the configured CR port (shared by the whole fleet).
          const address = socket.address();
          if (typeof address === 'object' && address !== null && 'address' in address) {
            listenAddr = address.address;
          }
          socket.end();
        })
        .on("close", () => {

          this._server = this._transport.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
            const path = (req.url || "/").replace(/^\/+/, "").replace(/\/+$/, "");
            const route = this._routes.get(path);
            if (!route) {
              res.writeHead(404);
              res.end();
              return;
            }
            if (this._logVerbose) this._log.debug(`Connection request for /${path}`);
            this.handleRequest(req, res, route);
          });

          this._server.on("error", reject); // e.g. EADDRINUSE → reject instead of crashing

          this._server.listen(listenPort, listenAddr, () => {
            const newUrl = `${this._options.ssl ? 'https' : 'http'}://${listenAddr}:${listenPort}/`;
            this._log.info(`Connection Request Server listening on ${newUrl}`);
            resolve({
              ssl: this._options.ssl,
              addr: listenAddr,
              port: listenPort,
              url: newUrl
            });
          });
        });
    });
  }

  /**
   * Authenticates an incoming request against the route's credentials, then
   * notifies the route.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {CrRoute} route - The routed target.
   */
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse, route: CrRoute) {
    const { user, pass } = route.credentials();
    // An auth *failure* = credentials were presented but wrong. The initial
    // no-`Authorization` 401 is the normal Digest/Basic challenge, not a failure.
    const authFail = () => {
      route.onAuthFail?.();
      this.sendChallenge(res);
    };

    if (user && pass) {
      const auth = req.headers['authorization'];

      if (!auth) {
        this.sendChallenge(res);
        return;
      }

      const parts = auth.split(' ');
      const scheme = parts[0];

      if (this._options.authMode === "Digest") {
        if (scheme !== "Digest" || !this.validateDigest(req, auth.substring(7), user, pass)) {
          authFail();
          return;
        }
      } else {
        // Basic
        if (scheme !== 'Basic') {
          authFail();
          return;
        }
        const credentials = Buffer.from(parts[1], 'base64').toString().split(':');
        if (credentials[0] !== user || credentials[1] !== pass) {
          authFail();
          return;
        }
      }
    }

    route.onReceived?.();
    this._log.info("Received Connection Request");
    res.writeHead(200);
    res.end();

    route.onRequest();
  }

  /**
   * Sends a 401 Challenge (Basic or Digest).
   * @param {http.ServerResponse} res
   */
  sendChallenge(res: http.ServerResponse) {
    if (this._options.authMode === "Digest") {
      const nonce = crypto.randomBytes(16).toString("hex");
      const realm = "CWMP Simulator";
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${realm}", qop="auth", nonce="${nonce}", opaque="${nonce}"`
      });
    } else {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="CWMP Simulator"' });
    }
    res.end();
  }

  /**
   * Validates a Digest Authorization header against the given credentials.
   * @param {http.IncomingMessage} req
   * @param {string} authHeaderStr
   * @param {string} user
   * @param {string} pass
   * @returns {boolean} True if valid.
   */
  validateDigest(req: http.IncomingMessage, authHeaderStr: string, user: string, pass: string): boolean {
    const params: any = {};
    const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(authHeaderStr)) !== null) {
      params[match[1]] = match[2] || match[3];
    }

    if (params.username !== user) return false;

    const ha1 = md5(`${user}:${params.realm}:${pass}`);
    const ha2 = md5(`${req.method}:${params.uri}`);
    const validResponse = md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`);

    return validResponse === params.response;
  }
}
