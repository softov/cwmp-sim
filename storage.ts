// Binary-side device-state file store. This lives OUTSIDE `src/` on purpose:
// the library + config layer stay filesystem-free (like fleet/02), and the CLI
// binary owns persistence. The library only emits `device:save` / pulls via
// `loadState` — it never imports this module.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SavedState } from "./src/types.ts";

/** Per-device state filename, with the serial sanitized to stay inside `dir`. */
function stateFile(dir: string, serial: string): string {
  return join(dir, `${serial.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

/**
 * Resolves a configured storage directory to an absolute path, expanding a
 * leading `~` to the user's home. The raw value comes from the CLI options
 * (`--storage-dir` / `STORAGE_DIR`, parsed by `buildOptions`); this only
 * normalizes it — it does not parse argv.
 */
export function resolveStorageDir(raw: string = join(homedir(), ".cwmp-sim", "devices")): string {
  return raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw;
}

/** Reads a device's saved state, or `undefined` if absent/unreadable. */
export function readState(dir: string, serial: string): SavedState | undefined {
  try {
    return JSON.parse(readFileSync(stateFile(dir, serial), "utf8")) as SavedState;
  } catch {
    return undefined;
  }
}

/** Atomically writes a device's state to `<dir>/<serial>.json` (temp + rename). */
export function writeState(dir: string, serial: string, state: SavedState): void {
  mkdirSync(dir, { recursive: true });
  const target = stateFile(dir, serial);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, target);
}
