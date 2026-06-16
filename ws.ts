// Minimal, dependency-free RFC 6455 WebSocket framing — just enough for a
// server-push feed: the SHA-1 accept key, server→client text frames, and
// decoding client control frames (ping/close). Pure functions so the tricky
// bit-twiddling is unit-tested in isolation. Scope: single (unfragmented)
// frames; that's all the live feed needs.

import { createHash } from "node:crypto";

export const OPCODES = { TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa } as const;

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** The `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`. */
export function acceptKey(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** Encodes a server→client **text** frame (FIN set, unmasked, 7/16/64-bit length). */
export function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.from([0x80 | OPCODES.TEXT, len]);
  } else if (len < 0x10000) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | OPCODES.TEXT;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | OPCODES.TEXT;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

/** Encodes a server→client control frame (close/ping/pong; payload ≤ 125, unmasked). */
export function encodeControlFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}

export type DecodedFrame = { opcode: number; payload: Buffer; fin: boolean };

/**
 * Decodes a single frame from `buf` (unmasking client→server payloads). Returns
 * `null` if the buffer doesn't yet hold a complete frame.
 */
export function decodeFrame(buf: Buffer): DecodedFrame | null {
  if (buf.length < 2) return null;

  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);

  if (mask) {
    const out = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
    payload = out;
  }

  return { opcode, payload: Buffer.from(payload), fin };
}
