"use strict";

/**
 * Our own RFC 4180 CSV reader + a header-keyed row mapper + a row→tree builder.
 * Zero dependencies. Built so a real GenieACS device dump (12 columns) loads
 * unchanged: rows are read by header *name*, so any extra columns are ignored.
 *
 * Our canonical schema is 5 columns:
 *   Parameter,Object,Writable,Value,Value type
 *   - Object=true  → a container node (intermediate; no value)
 *   - Object=false → a leaf { _value, _type, _writable }
 */

/** Parsed template: the inferred root key (`Device` / `InternetGatewayDevice`) + the tree. */
export type LoadedTemplate = { root: string; tree: Record<string, any> };

/**
 * Parses CSV text into a table of rows of raw string cells (RFC 4180).
 * Handles quoted fields (commas / newlines inside quotes), `""` escaping,
 * CRLF or LF record separators, and a leading UTF-8 BOM.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r") { endRow(); if (text[i + 1] === "\n") i += 2; else i++; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    field += c; i++;
  }
  // Flush the final field/row unless the input ended exactly on a record separator.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Maps a parsed table to header-keyed row objects. The first row is the header;
 * each subsequent row becomes `{ [headerName]: cell }`. Blank lines are skipped.
 * Reading by name is what lets a 12-column GenieACS dump load — we only ever
 * look up the columns we care about.
 */
export function toRows(table: string[][]): Record<string, string>[] {
  if (table.length === 0) return [];
  const header = table[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.length === 1 && cells[0].trim() === "") continue; // blank line
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? "";
    out.push(obj);
  }
  return out;
}

const isTrue = (v: string | undefined): boolean => String(v ?? "").trim().toLowerCase() === "true";

/**
 * Builds a parameter tree from header-keyed rows. The root key is inferred from
 * the rows (prefers `Device` / `InternetGatewayDevice`); rows outside that root
 * — e.g. GenieACS's virtual `DeviceID.*` / `Tags.*` rows — are skipped.
 *
 * @param rows - header-keyed rows; uses `Parameter,Object,Writable,Value,Value type`.
 * @returns the inferred `root` and the `tree` (shaped like `{ [root]: {...} }`).
 */
export function rowsToTree(rows: Record<string, string>[]): LoadedTemplate {
  const tops = rows.map((r) => (r.Parameter || "").split(".")[0]).filter(Boolean);
  const root = tops.find((t) => t === "Device" || t === "InternetGatewayDevice") ?? tops[0] ?? "Device";

  const tree: Record<string, any> = {};
  for (const r of rows) {
    const param = (r.Parameter || "").trim();
    const parts = param.split(".").filter((p) => p !== "");
    if (!parts.length || parts[0] !== root) continue; // skip virtual / foreign rows

    // Walk to the parent, creating containers as needed.
    let cur = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (cur[key] === undefined || cur[key]._value !== undefined) cur[key] = {};
      cur = cur[key];
    }

    const leaf = parts[parts.length - 1];
    if (isTrue(r.Object)) {
      // A container row: ensure the node exists; record its writability once.
      if (cur[leaf] === undefined || cur[leaf]._value !== undefined) cur[leaf] = {};
      if (cur[leaf]._writable === undefined) cur[leaf]._writable = isTrue(r.Writable);
    } else {
      cur[leaf] = {
        _value: r.Value ?? "",
        _type: (r["Value type"] || "xsd:string").trim() || "xsd:string",
        _writable: isTrue(r.Writable),
      };
    }
  }
  return { root, tree };
}
