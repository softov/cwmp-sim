
import http from "http";
import https from "https";
import crypto from "crypto";

type DigestParams = {
  realm?: string;
  nonce?: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  nc?: number;
  cnonce?: string;
}
type RequestParams = {
  method: string;
  uri: string;
  username: string;
  password: string;
  body?: string | Buffer;
  digest?: DigestParams;
  transport?: HttpTransport;
  agent?: http.Agent;
  cookies?: string[];
}

function md5(data: string) {
  return crypto.createHash("md5").update(data).digest("hex");
}

function isXmlBody(body: any) {
  if (!body) return false;
  if (typeof body !== "string") return false;
  return body.startsWith("<?xml");
}

function getBodyLength(body: any) {
  if (!body) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  return body.length;
}

function parseDigestHeader(header: string): DigestParams {
  const params = {};
  const digestStr = header.replace(/^Digest\s+/i, "");
  const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let match: RegExpExecArray;

  while ((match = regex.exec(digestStr)) !== null) {
    const key = match[1];
    const value = match[2] || match[3];
    params[key] = value;
  }
  return params as DigestParams;
}

function buildDigestAuth(params: RequestParams, nc: string) {
  const realm = params.digest?.realm || "";
  const nonce = params.digest?.nonce || "";
  const qop = params.digest?.qop || "";
  const opaque = params.digest?.opaque || "";
  const algorithm = params.digest?.algorithm || "MD5";
  const cnonce = crypto.randomBytes(16).toString("hex");

  let ha1 = '';
  if (algorithm.toUpperCase() === "MD5-SESS") {
    const ha1Base = md5(`${params.username}:${realm}:${params.password}`);
    ha1 = md5(`${ha1Base}:${nonce}:${cnonce}`);
  } else {
    ha1 = md5(`${params.username}:${realm}:${params.password}`);
  }

  const ha2 = md5(`${params.method}:${params.uri}`);
  let response;
  const ncStr = String(nc).padStart(8, "0");

  if (qop === "auth" || qop === "auth-int") {
    response = md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  let authHeader = `Digest username="${params.username}", realm="${realm}", nonce="${nonce}", uri="${params.uri}", response="${response}"`;

  if (algorithm) authHeader += `, algorithm=${algorithm}`;
  if (opaque) authHeader += `, opaque="${opaque}"`;
  if (qop) authHeader += `, qop=${qop}, nc=${ncStr}, cnonce="${cnonce}"`;

  return authHeader;
}

/**
 * Do HTTP/HTTPS request with Digest support
 */
export async function requestWithDigest(options: RequestParams = {
  method: "GET",
  uri: "",
  username: "",
  password: "",
  body: undefined,
  digest: null
}): Promise<{ res: http.IncomingMessage, body: string }> {

  // console.log(`requestWithDigest URL: ${options.uri}`);

  const url = new URL(options.uri);
  const transport = options.transport || (url.protocol === "https:" ? https : http);
  const method = options.method || "GET";
  const username = options.username;
  const password = options.password;
  const body = options.body;
  const agent = options.agent;

  function doAuthHeader(headers: Record<string, string>) {
    if (options.digest) {
      const nc = "00000001";
      const authDigest = buildDigestAuth({
        method,
        uri: url.pathname,
        username,
        password,
        digest: options.digest,
      }, nc);
      headers["Authorization"] = authDigest;
      return authDigest;
    }
    headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

    if (options.cookies && options.cookies.length > 0) {
      headers["Cookie"] = options.cookies.join("; ");
    }
    return headers;
  }

  function doRequest() {
    const headers: Record<string, string> = {
      "User-Agent": "CWMP/1.0",
      "Content-Length": getBodyLength(body),
      "Content-Type": isXmlBody(body) ? 'text/xml; charset="utf-8"' : "",
    };
    doAuthHeader(headers);
    return new Promise((resolve, reject) => {
      const req = transport.request({
        method,
        headers,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        agent
      }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ res, data }));
        res.on("error", (e: Error) => {
          console.error(`Response error: ${e.message}`);
          reject(e);
        });
      }
      );
      req.on("error", (e: Error) => {
        console.error(`Request error: ${e.message}`);
        reject(e);
      });
      req.setTimeout(30000, () => {
        console.log(`Request timed out after ${30} seconds.`);
        reject(new Error(`Request timed out after ${30} seconds.`));
      });
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }
  return doRequest().then(async ({ res, data }): Promise<{ res: http.IncomingMessage, body: string }> => {
    if (res.statusCode !== 401) {
      return { res: res, body: data };
    }
    const wwwAuth = res.headers["www-authenticate"];
    if (!wwwAuth || !wwwAuth.startsWith("Digest")) {
      throw new Error("Digest auth not supported by server");
    }
    const cookies = res.headers["set-cookie"];
    if (cookies) {
      options.cookies = cookies;
    }
    options.digest = parseDigestHeader(wwwAuth);
    return doRequest().then(({ res, data }) => ({
      res: res,
      body: data
    }));
  });
}

type HttpTransport = {
  request: typeof http.request;
  Agent: typeof http.Agent;
};

/**
 * Handles HTTP/HTTPS communications with the ACS.
 */
export default class CwmpHttp {
  _agent = null;
  _transport: HttpTransport;
  _requestParams: RequestParams;
  _requestUrl: URL;

  /**
   * Creates a new CwmpHttp instance.
   * @param {CWMPDevice} device - The device instance.
   */
  constructor(params: RequestParams) {
    this._requestParams = params;
    if (!this._requestParams) {
      throw new Error("Request params are required");
    }
    if (!this._requestParams.uri) {
      throw new Error("ACS URL is required");
    }
    this._requestUrl = new URL(this._requestParams.uri);
    this._transport = this._requestUrl?.protocol === 'https:' ? https : http;
  }

  setParams(params: RequestParams) {
    this._requestParams.username = params.username;
    this._requestParams.password = params.password;
    this._requestParams.digest = params.digest;
    this._requestParams.uri = params.uri;
    this._requestUrl = new URL(this._requestParams.uri);
    return this;
  }

  /**
   * Cleans up resources (e.g. agent).
   */
  finish() {
    if (this._agent) {
      this._agent.destroy();
      this._agent = null;
    }
  }

  /**
   * Sends a SOAP XML message to the ACS.
   * Handles Digest Auth retries and Cookie management.
   * @param {string} xml - The XML body.
   * @returns {Promise<string>} The response body.
   */
  async sendRequest(xml: string): Promise<string> {

    if (!this._agent) {
      this._agent = new this._transport.Agent({ keepAlive: true, maxSockets: 1 });
    }

    this._requestParams.transport = this._transport;
    this._requestParams.agent = this._agent;
    this._requestParams.body = xml;

    const { res, body } = await requestWithDigest(this._requestParams);

    if (res.statusCode === 204 || body.length === 0) {
      this.finish();
      return null;
    }

    if (res.statusCode !== 200) {
      this.finish();
      throw new Error(`Non-200 response from ACS: ${res.statusCode}`);
    }

    return body;
  }
}