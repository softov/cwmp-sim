"use strict";

import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, toRows, rowsToTree, type LoadedTemplate } from "./csv.ts";
import { jsonToTree } from "./json.ts";

export type { LoadedTemplate };

/** Parses CSV template text into a `{ root, tree }`. */
export function parseCsvTemplate(text: string): LoadedTemplate {
  return rowsToTree(toRows(parseCsv(text)));
}

/** Parses JSON template text (plain nested values) into a `{ root, tree }`. */
export function parseJsonTemplate(text: string): LoadedTemplate {
  return jsonToTree(JSON.parse(text));
}

/**
 * Resolves a template reference to a file path. An explicit `.csv`/`.json` path
 * is used as-is; otherwise a bare name is looked up under `dir` as
 * `name.csv` then `name.json`.
 */
async function resolveTemplatePath(nameOrPath: string, dir: string): Promise<string> {
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
  throw new Error(`Template not found: '${nameOrPath}' (looked in '${dir}' for .csv / .json)`);
}

/**
 * Loads a device template by name or path. CSV and JSON are both supported;
 * the format is chosen by file extension. Returns the inferred root key and the
 * parameter tree (base for a `CWMPDevice` — required nodes + identity are
 * overlaid by the device, not here).
 *
 * @param nameOrPath - a bare template name (resolved under `dir`) or a direct `.csv`/`.json` path.
 * @param dir - directory to resolve bare names from (default `./templates`).
 */
export async function loadTemplate(nameOrPath: string, dir = "./templates"): Promise<LoadedTemplate> {
  const file = await resolveTemplatePath(nameOrPath, dir);
  const text = await fs.readFile(file, "utf8");
  return /\.json$/i.test(file) ? parseJsonTemplate(text) : parseCsvTemplate(text);
}
