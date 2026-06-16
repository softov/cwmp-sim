import { test } from "node:test";
import assert from "node:assert/strict";

import CWMPConn, { type CrRoute } from "../src/cwmp-conn.ts";

function makeConn(opts: Record<string, unknown> = {}) {
  return new CWMPConn("http://127.0.0.1:7547/", { authMode: "none", ...opts } as any);
}

function mockRes() {
  const r: any = { statusCode: 0, ended: false, headers: null };
  r.writeHead = (code: number, headers?: any) => { r.statusCode = code; r.headers = headers; return r; };
  r.end = () => { r.ended = true; };
  return r;
}

test("register / unregister manage the routing table", () => {
  const conn = makeConn();
  const route: CrRoute = { credentials: () => ({ user: "", pass: "" }), onRequest: () => {} };
  conn.register("abc", route);
  assert.equal(conn._routes.get("abc"), route);
  conn.unregister("abc");
  assert.equal(conn._routes.has("abc"), false);
});

test("handleRequest with no credentials dispatches onRequest and 200s", () => {
  const conn = makeConn();
  let hit = false;
  const route: CrRoute = { credentials: () => ({ user: "", pass: "" }), onRequest: () => (hit = true) };
  const res = mockRes();
  conn.handleRequest({ headers: {}, method: "GET" } as any, res, route);
  assert.equal(hit, true);
  assert.equal(res.statusCode, 200);
});

test("handleRequest challenges (401) when credentials are required but missing", () => {
  const conn = makeConn({ authMode: "Basic" });
  let hit = false;
  const route: CrRoute = { credentials: () => ({ user: "u", pass: "p" }), onRequest: () => (hit = true) };
  const res = mockRes();
  conn.handleRequest({ headers: {}, method: "GET" } as any, res, route);
  assert.equal(res.statusCode, 401);
  assert.equal(hit, false);
});

test("handleRequest accepts a valid Basic credential", () => {
  const conn = makeConn({ authMode: "Basic" });
  let hit = false;
  const route: CrRoute = { credentials: () => ({ user: "u", pass: "p" }), onRequest: () => (hit = true) };
  const res = mockRes();
  const basic = "Basic " + Buffer.from("u:p").toString("base64");
  conn.handleRequest({ headers: { authorization: basic }, method: "GET" } as any, res, route);
  assert.equal(hit, true);
  assert.equal(res.statusCode, 200);
});

test("the route asks for credentials lazily (per request)", () => {
  const conn = makeConn({ authMode: "Basic" });
  let creds = { user: "u", pass: "old" };
  const route: CrRoute = { credentials: () => creds, onRequest: () => {} };
  const res1 = mockRes();
  conn.handleRequest({ headers: { authorization: "Basic " + Buffer.from("u:old").toString("base64") }, method: "GET" } as any, res1, route);
  assert.equal(res1.statusCode, 200);
  // The ACS rotates the password; the next request must use the new one.
  creds = { user: "u", pass: "new" };
  const res2 = mockRes();
  conn.handleRequest({ headers: { authorization: "Basic " + Buffer.from("u:old").toString("base64") }, method: "GET" } as any, res2, route);
  assert.equal(res2.statusCode, 401);
});
