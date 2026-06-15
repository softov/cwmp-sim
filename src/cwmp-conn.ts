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

type HttpTransport = {
  createServer: typeof http.createServer;
  request: typeof http.request;
  Agent: typeof http.Agent;
};

/**
 * Handles incoming connection requests (CPE Server).
 * Supports Basic and Digest authentication.
 */
export default class CWMPConn {
  _transport: HttpTransport = null;
  _options: CwmpConnOptions = null;
  _netConfig: net.NetConnectOpts = null;
  _server: http.Server | https.Server = null;
  _logVerbose = true;
  _log: Logger = NULL_LOGGER;
  _onRequest: (event: string) => void = null;
  _onListening: () => void = null;
  _requestOptions: any = null;

  /**
   * Creates a new connection request handler.
   * @param {string} acsUrl - The URL to detect IP (DAMMM!!!)
   * @param {object} options - Configuration options.
   */
  constructor(acsUrl: string, options: CwmpConnOptions, logger: Logger = NULL_LOGGER) {
    this._log = logger;
    this._options = {
      authMode: 'Digest',
      addr: '0.0.0.0',
      port: 7547,
      ...options,
    };

    const parsedUrl = new URL(acsUrl);
    this._netConfig = {
      // protocol: parsedUrl.protocol,
      host: parsedUrl.hostname,
      port: parseInt(parsedUrl.port),
      family: 4,
      // path: parsedUrl.pathname,
      // path: parsedUrl.pathname + parsedUrl.search,
      // href: parsedUrl.href
    };

    this._server = null;
    this._onRequest = () => { };
    this._onListening = () => { };
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
   * Starts the HTTP server for connection requests.
   * @param {Function} callback - Called when a valid connection request is received.
   * @returns {http.Server} The Node.js HTTP server instance.
   */
  async listenHTTP(callback: (event: string) => void): Promise<ConnectionRequest> {
    this._onRequest = callback;

    return new Promise((resolve, reject) => {
      let listenPort: number = this._options.port;
      let listenAddr = this._options.addr;
      // Start a dummy socket to get the used local ip
      let socket = net.createConnection(this._netConfig)
        .on("error", reject)
        .on("connect", () => {
          this._log.debug('connect address');
          const address = socket.address();
          if (typeof address === 'object' && address !== null) {
            if ('address' in address) listenAddr = address.address;
            if ('port' in address) listenPort = (address.port as number) - 1;
          }
          socket.end();
        })
        .on("close", () => {

          this._server = this._transport.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
            if (req.url !== '/') {
              res.writeHead(404);
              res.end();
              return;
            }
            if (this._logVerbose) this._log.debug(`Simulator ${listenAddr}:${listenPort} got connection request`);
            this.emit('requested');
            this.handleRequest(req, res);

          }).listen(listenPort, listenAddr, () => {
            // if (err) throw err;
            // const theAddr = this._server.address();
            // listenAddr = typeof theAddr === 'object' && theAddr !== null ? theAddr.address : listenAddr;
            // listenPort = typeof theAddr === 'object' && theAddr !== null ? theAddr.port : listenPort;
            const newUrl = `${this._options.ssl ? 'https' : 'http'}://${listenAddr}:${listenPort}/`;
            if (this._logVerbose) {
              this._log.info(`Simulator ${listenAddr}:${listenPort} Connection Request Server listening on ${newUrl}`);
              this._log.debug(`Simulator`, this._server.address());
            }
            this.emit('listening');
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

  emit(event: string) {
    // do nothing
  }
  /**
   * Internal handler for incoming HTTP requests.
   * Performs authentication checks and triggers the callback.
   * @param {http.IncomingMessage} req 
   * @param {http.ServerResponse} res 
   */
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (this._options.user && this._options.pass) {
      const auth = req.headers['authorization'];

      if (!auth) {
        this.sendChallenge(res);
        return;
      }

      const parts = auth.split(' ');
      const scheme = parts[0];

      if (this._options.authMode === "Digest") {
        if (scheme !== "Digest") {
          this.sendChallenge(res);
          return;
        }

        if (!this.validateDigest(req, auth.substring(7))) {
          this.sendChallenge(res);
          return;
        }
      } else {
        // Basic
        if (scheme !== 'Basic') {
          this.sendChallenge(res);
          return;
        }

        const credentials = Buffer.from(parts[1], 'base64').toString().split(':');
        if (credentials[0] !== this._options.user || credentials[1] !== this._options.pass) {
          this.sendChallenge(res);
          return;
        }
      }
    }

    this._log.info("Received Connection Request");
    res.writeHead(200);
    res.end();

    // if (this.onGoingSession) {
    //   this.pendingAcsRequest = true;
    // }

    if (this._onRequest) {
      this._onRequest("6 CONNECTION REQUEST");
    }
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
   * Validates a Digest Authorization header.
   * @param {http.IncomingMessage} req 
   * @param {string} authHeaderStr 
   * @returns {boolean} True if valid.
   */
  validateDigest(req: http.IncomingMessage, authHeaderStr: string): boolean {
    const params: any = {};
    const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(authHeaderStr)) !== null) {
      params[match[1]] = match[2] || match[3];
    }

    if (params.username !== this._options.user) return false;

    const ha1 = md5(`${this._options.user}:${params.realm}:${this._options.pass}`);
    const ha2 = md5(`${req.method}:${params.uri}`);
    const validResponse = md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`);

    return validResponse === params.response;
  }
}
