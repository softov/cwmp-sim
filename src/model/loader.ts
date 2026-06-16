"use strict";

import { parseCsv, toRows, rowsToTree } from "./csv.ts";
import { jsonToTree } from "./json.ts";
import type { LoadedModel } from "../types.ts";

// Pure model parsers (text → tree). No filesystem access — reading a model file
// from disk is the binary's job (see root `models.ts`), keeping `src/` I/O-free.

/** Parses CSV model text into a `{ root, tree }`. */
export function parseCsvModel(text: string): LoadedModel {
  return rowsToTree(toRows(parseCsv(text)));
}

/** Parses JSON model text (plain nested values) into a `{ root, tree }`. */
export function parseJsonModel(text: string): LoadedModel {
  return jsonToTree(JSON.parse(text));
}
