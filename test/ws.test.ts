import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptKey, encodeTextFrame, encodeControlFrame, decodeFrame, OPCODES } from "../ws.ts";

test("acceptKey matches the RFC 6455 example vector", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("encodeTextFrame/decodeFrame round-trip across length boundaries", () => {
  for (const len of [0, 5, 125, 126, 200, 65535, 65536, 70000]) {
    const text = "x".repeat(len);
    const decoded = decodeFrame(encodeTextFrame(text));
    assert.ok(decoded, `len ${len} should decode`);
    assert.equal(decoded!.opcode, OPCODES.TEXT);
    assert.equal(decoded!.fin, true);
    assert.equal(decoded!.payload.toString("utf8"), text);
  }
});

test("encodeTextFrame picks the right length encoding and never masks", () => {
  assert.equal(encodeTextFrame("a")[1] & 0x7f, 1); // 7-bit
  assert.equal(encodeTextFrame("x".repeat(126))[1] & 0x7f, 126); // 16-bit marker
  assert.equal(encodeTextFrame("x".repeat(70000))[1] & 0x7f, 127); // 64-bit marker
  assert.equal(encodeTextFrame("a")[1] & 0x80, 0); // server frames are unmasked
});

test("decodeFrame unmasks a client→server frame", () => {
  const payload = Buffer.from("hi", "utf8");
  const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) maskedPayload[i] = payload[i] ^ mask[i & 3];

  const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, maskedPayload]);
  const decoded = decodeFrame(frame);
  assert.equal(decoded!.payload.toString("utf8"), "hi");
});

test("decodeFrame returns null for an incomplete buffer", () => {
  assert.equal(decodeFrame(Buffer.from([0x81])), null); // header only
  assert.equal(decodeFrame(Buffer.from([0x81, 126, 0x00])), null); // missing 2nd 16-bit length byte
});

test("decodeFrame reads control opcodes (ping/close)", () => {
  assert.equal(decodeFrame(encodeControlFrame(OPCODES.PING))!.opcode, OPCODES.PING);
  assert.equal(decodeFrame(encodeControlFrame(OPCODES.CLOSE))!.opcode, OPCODES.CLOSE);
});
