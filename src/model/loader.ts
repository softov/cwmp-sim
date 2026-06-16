"use strict";

import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, toRows, rowsToTree } from "./csv.ts";
import { jsonToTree } from "./json.ts";
import type { LoadedModel } from "../types.ts";

/** Parses CSV model text into a `{ root, tree }`. */
export function parseCsvModel(text: string): LoadedModel {
  return rowsToTree(toRows(parseCsv(text)));
}

/** Parses JSON model text (plain nested values) into a `{ root, tree }`. */
export function parseJsonModel(text: string): LoadedModel {
  return jsonToTree(JSON.parse(text));
}

/**
 * Resolves a model reference to a file path. An explicit `.csv`/`.json` path
 * is used as-is; otherwise a bare name is looked up under `dir` as
 * `name.csv` then `name.json`.
 */
async function resolveModelPath(nameOrPath: string, dir: string): Promise<string> {
  if (/\.(csv|json)$/i.test(nameOrPath)) return nameOrPath;
  for (const ext of [".csv", ".json"]) {
    const candidate = path.join(dir, nameOrPath + ext);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try next extension */
    }
  }
  throw new Error(`Model not found: '${nameOrPath}' (looked in '${dir}' for .csv / .json)`);
}

/**
 * Loads a device model by name or path. CSV and JSON are both supported;
 * the format is chosen by file extension. Returns the inferred root key and the
 * parameter tree (base for a `CWMPDevice` — required nodes + identity are
 * overlaid by the device, not here).
 *
 * @param nameOrPath - a bare model name (resolved under `dir`) or a direct `.csv`/`.json` path.
 * @param dir - directory to resolve bare names from (default `./models`).
 */
export async function loadModel(nameOrPath: string, dir = "./models"): Promise<LoadedModel> {
  const file = await resolveModelPath(nameOrPath, dir);
  const text = await fs.readFile(file, "utf8");
  return /\.json$/i.test(file) ? parseJsonModel(text) : parseCsvModel(text);
}
