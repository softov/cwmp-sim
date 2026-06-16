"use strict";

import CWMPDevice from "./cwmp-device.ts";
import CWMPConn from "./cwmp-conn.ts";
import type { ConnectionRequest } from "./cwmp-conn.ts";
import type { CwmpSimulatorOptions, FleetGroup } from "./types.ts";
import { createLogger, NULL_LOGGER, type Logger } from "./logger.ts";
import { EventEmitter } from "node:events";

/** A live handle to one added group — its devices + remove/restart controls. */
export type FleetGroupHandle = {
  id: string;
  devices: CWMPDevice[];
  /** Remove the group's devices from the fleet (saves dirty, stops, CR-unregisters). */
  remove(): void;
  /** Reboot the group's devices in place ("1 BOOT"). */
  restart(): void;
};

/**
 * Orchestrates a fleet of simulated CPEs: builds N self-running devices and
 * fronts them with a single shared Connection Request server that routes by URL
 * path (`/{hash}`). Each device runs its own CWMP session with the ACS.
 *
 * The fleet is built from `fleet.groups` (mixed device types) through one
 * reusable seam, `addGroup()` — the same path used to add/remove/restart groups
 * at runtime. An EventEmitter: emits `device:add`/`device:remove`/`device:save`/
 * `device:load` (and more — see fleet/04 Phase 2).
 */
export default class CWMPSimulator extends EventEmitter {
  _devices: CWMPDevice[] = [];
  _connectRequestServer: CWMPConn | null = null;
  _connection: ConnectionRequest | null = null;
  _options: CwmpSimulatorOptions;
  _log: Logger = NULL_LOGGER;
  /** Running identity index, incremented across every device of every group. */
  _nextIndex = 0;
  /** Live group registry, keyed by handle id. */
  _groups: Map<string, { id: string; devices: CWMPDevice[] }> = new Map();
  _nextGroupId = 0;

  /**
   * Builds the fleet from `fleet.groups` (or a single implicit group derived
   * default group), each device configured against the ACS.
   * @param {object} options - Configuration options.
   */
  constructor(options: CwmpSimulatorOptions) {
    super();
    this._options = { ...options };

    // Per-instance logger: a consumer-supplied logger wins; otherwise build the
    // built-in one from options.log. With no options.log the logger is silent.
    this._log = options.log?.logger
      ?? createLogger({ level: options.log?.level, prefix: options.log?.prefix, sink: options.log?.sink });

    this._nextIndex = options.fleet?.index ?? 0;

    // It's all fleet: a single default device is a fleet of one default group.
    const groups: FleetGroup[] = options.fleet?.groups?.length
      ? options.fleet.groups
      : [{ count: 1, device: {} }];

    for (const group of groups) this.addGroup(group);
  }

  /**
   * Builds (and, if the fleet is already running, registers + boots) the devices
   * for one group, tracks it in the registry, and returns a handle to control it.
   * The single seam shared by construction-time composition and runtime adds.
   * @returns a handle: `{ id, devices, remove(), restart() }`.
   */
  addGroup(group: FleetGroup): FleetGroupHandle {
    const id = `g${this._nextGroupId++}`;
    const count = Math.max(1, group.count ?? 1);
    const devices: CWMPDevice[] = [];

    for (let i = 0; i < count; i++) {
      const device = new CWMPDevice({
        ...group.device,
        model: group.model ?? group.device?.model,
        index: this._nextIndex++,
        logger: this._log,
      });
      device.configureManagementServer({
        acsUrl: this._options.acs.url,
        acsUser: this._options.acs.user,
        acsPass: this._options.acs.pass,
        crUser: this._options.conn.user,
        crPass: this._options.conn.pass,
      });
      this._wireDeviceEvents(device);
      this._devices.push(device);
      devices.push(device);
      this.emit("device:add", device);

      // Already listening (runtime add) → register + boot immediately.
      if (this._connection) this._registerAndBoot(device, 0);
    }

    this._groups.set(id, { id, devices });
    return {
      id,
      devices,
      remove: () => this.removeGroup(id),
      restart: () => this.restartGroup(id),
    };
  }

  /** Removes every device in a group, then forgets the group. No-op if unknown. */
  removeGroup(id: string): void {
    const entry = this._groups.get(id);
    if (!entry) return;
    for (const device of [...entry.devices]) this.removeDevice(device);
    this._groups.delete(id);
  }

  /** Reboots every device in a group in place. No-op if unknown. */
  restartGroup(id: string): void {
    const entry = this._groups.get(id);
    if (!entry) return;
    for (const device of [...entry.devices]) this.rebootDevice(device);
  }

  /**
   * Removes one device from the fleet: saves it if dirty, stops its session,
   * unregisters its CR route (when listening), drops it from `_devices` and its
   * group, and emits `device:remove`. The fleet index is not reused.
   */
  removeDevice(device: CWMPDevice): void {
    if (device._dirty) device.saveState();
    device.stop();
    this._connectRequestServer?.unregister(device.getConnectionHash());

    const i = this._devices.indexOf(device);
    if (i >= 0) this._devices.splice(i, 1);
    for (const entry of this._groups.values()) {
      const j = entry.devices.indexOf(device);
      if (j >= 0) entry.devices.splice(j, 1);
    }

    this.emit("device:remove", device);
  }

  /** Reboots one device in place: `stop()` then `start("1 BOOT")`. */
  rebootDevice(device: CWMPDevice): void {
    device.stop();
    device.start("1 BOOT");
  }

  /**
   * Forwards a device's lifecycle events to the fleet bus and wires the
   * dirty-gated auto-save after each CWMP session.
   */
  _wireDeviceEvents(device: CWMPDevice): void {
    device._events.on("save", (dev, state) => this.emit("device:save", dev, state));
    device._events.on("load", (dev, state) => this.emit("device:load", dev, state));
    device._events.on("boot", (dev, event) => this.emit("device:boot", dev, event));
    device._events.on("inform", (dev, event) => this.emit("device:inform", dev, event));
    device._events.on("session-start", (dev, event) => this.emit("device:session", dev, "start", event));
    device._events.on("diagnostic", (dev, type, phase) => this.emit("device:diagnostic", dev, type, phase));
    device._events.on("session-end", (dev: CWMPDevice) => {
      this.emit("device:session", dev, "end");
      // Dirty-gated auto-save after each session.
      if (dev._dirty) dev.saveState();
    });
  }

  /**
   * Applies any saved state (from `options.loadState`) onto a device just before
   * it boots — keeps load at boot-time (not construction) and I/O in the caller.
   */
  _applyLoadedState(device: CWMPDevice): void {
    const saved = this._options.loadState?.(device._serialNumber);
    if (saved) device.importState(saved);
  }

  /** Snapshots every device's state (each emits `device:save`). */
  saveAll(): void {
    for (const device of this._devices) device.saveState();
  }

  /**
   * Registers a device's CR route on the shared server and boots its session
   * after `delayMs`. Requires the CR server to be listening.
   */
  _registerAndBoot(device: CWMPDevice, delayMs: number): void {
    const server = this._connectRequestServer;
    const connection = this._connection;
    if (!server || !connection) return;

    const hash = device.getConnectionHash();
    server.register(hash, {
      credentials: () => device.getCrCredentials(),
      onRequest: () => device.onConnectionRequest(),
    });
    device.setConnectionRequestURL(`${connection.url}${hash}`);
    // Restore saved state before the first Inform; device.start() then sets the
    // clean baseline so loaded values aren't treated as unsaved changes.
    this._applyLoadedState(device);
    setTimeout(() => device.start(), delayMs);
  }

  /**
   * Starts the shared Connection Request server, then registers and boots each
   * device (staggered by `fleet.bootDelay`). Each device's CR URL is
   * `http://addr:port/{hash}` where hash is derived from its serial.
   */
  start() {
    const delay = this._options.fleet?.bootDelay ?? 1000;

    // Already listening — just (re)boot the devices.
    if (this._connectRequestServer) {
      this._devices.forEach((device, i) => setTimeout(() => device.start(), i * delay));
      return this._connectRequestServer;
    }

    const server = new CWMPConn(this._options.acs.url, this._options.conn, this._log);
    this._connectRequestServer = server;

    server.listenHTTP().then((connection: ConnectionRequest) => {
      this._connection = connection;
      this._devices.forEach((device, i) => this._registerAndBoot(device, i * delay));
    }).catch((err: Error) => {
      this._log.error(`Failed to start connection server: ${err.message}`);
    });

    return server;
  }

  /**
   * Saves any devices with unsaved changes, stops every device session, and
   * closes the Connection Request server.
   */
  stop() {
    for (const device of this._devices) {
      if (device._dirty) device.saveState();
      device.stop();
    }
    if (this._connectRequestServer?._server) {
      this._connectRequestServer._server.close();
    }
  }
}
