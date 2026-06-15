"use strict";

/**
 * Minimal, dependency-free, level-based logger.
 *
 * Verbosity order: silent < error < warn < info < debug < trace.
 * A message logged at level L is emitted only when L <= the configured level.
 * The library defaults to "silent"; the CLI configures "info" (see config/fields.ts).
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5
};

const COLORS: Record<Exclude<LogLevel, "silent">, string> = {
  error: "\x1b[31m",
  warn: "\x1b[33m",
  info: "\x1b[32m",
  debug: "\x1b[36m",
  trace: "\x1b[34m"
};

export const LOG_LEVELS = Object.keys(ORDER) as LogLevel[];

/** Levels that actually emit (everything except "silent"). */
export type EmitLevel = Exclude<LogLevel, "silent">;

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  trace(...args: unknown[]): void;
}

export type LoggerSink = (level: EmitLevel, args: unknown[]) => void;

export type LoggerOptions = {
  level?: LogLevel;
  prefix?: string;
  sink?: LoggerSink;
};

function defaultSink(level: EmitLevel, args: unknown[]): void {
  const color = COLORS[level];
  const reset = "\x1b[0m";
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`${color}[${level}]${reset}`, ...args);
}

/**
 * Creates a level-filtered logger. With no options it is silent.
 * @param opts.level  Verbosity threshold (default "silent").
 * @param opts.prefix Prepended to every emitted message (e.g. a device serial).
 * @param opts.sink   Low-level emitter; defaults to console.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const threshold = ORDER[opts.level ?? "silent"];
  const sink = opts.sink ?? defaultSink;
  const pfx = opts.prefix ? [opts.prefix] : [];

  const at =
    (name: EmitLevel) =>
    (...args: unknown[]): void => {
      if (ORDER[name] <= threshold) sink(name, pfx.length ? [...pfx, ...args] : args);
    };

  return {
    error: at("error"),
    warn: at("warn"),
    info: at("info"),
    debug: at("debug"),
    trace: at("trace")
  };
}

/** Shared silent logger — the default when no logger is configured. */
export const NULL_LOGGER: Logger = createLogger({ level: "silent" });
