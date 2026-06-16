"use strict";

/**
 * Resolves a device-index template token in identity strings.
 *
 * Supported tokens (inside `{...}`):
 *   {i}          → the index            ("SIM-{i}"      , 7  → "SIM-7")
 *   {i:04}       → zero-padded decimal   ("SIM-{i:04}"   , 7  → "SIM-0007")
 *   {i+100}      → offset                ("{i+100}"      , 5  → "105")
 *   {i+10:03}    → offset + zero-pad      ("dev-{i+10:03}", 5  → "dev-015")
 *   {i:x} / {i:X}→ lower/upper hex        ("{i:02x}"      , 255 → "ff")
 *   {i:02x}      → zero-padded hex        ("00:E0:FC:00:00:{i:02x}", 1 → "00:E0:FC:00:00:01")
 *
 * Strings without a `{i...}` token are returned unchanged.
 */
export function applyTemplate(value: string, index: number): string {
  if (typeof value !== "string" || !value.includes("{i")) return value;

  return value.replace(/\{i(?:\+(\d+))?(?::(\d*)([xX])?)?\}/g, (_match, offset, pad, radix) => {
    const n = index + (offset ? parseInt(offset, 10) : 0);
    let s = radix ? n.toString(16) : String(n);
    if (radix === "X") s = s.toUpperCase();
    if (pad) s = s.padStart(parseInt(pad, 10), "0");
    return s;
  });
}
