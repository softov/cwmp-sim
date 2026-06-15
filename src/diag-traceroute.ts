
import { exec } from "child_process";
import CWMPTask from "./cwmp-task.ts";
import CWMPDevice from "./cwmp-device.ts";
import { tracerouteCommand, parseTracerouteHops } from "./diag-platform.ts";

/**
 * Task implementation for TraceRoute Diagnostics.
 */
export default class DiagTraceroute extends CWMPTask {
  _type = "diag-traceroute";
  _options = {
    _host: "",
    _maxHopCount: 0,
    _timeout: 0,
  };
  _result = {
    _hopCount: 0,
    _lastResponseTime: 0,
  };

  constructor(device: CWMPDevice) {
    super(device);
  }

  /**
   * Registers the listener for DiagnosticsState changes.
   */
  register() {
    this._key = this._device._rootName === "Device"
      ? "Device.IP.Diagnostics.TraceRoute"
      : "InternetGatewayDevice.TraceRouteDiagnostics";

    this._device.addListener(`${this._key}.DiagnosticsState`, (val) => {
      this._device._log.debug(`${this._key}.DiagnosticsState changed ${val}`);
      this.dispatch();
    });
  }

  /**
   * Validates parameters and dispatches the traceroute task if requested.
   */
  dispatch() {
    this._isRequested = false;
    const path = this._key;
    const state = this._device.getValue(`${path}.DiagnosticsState`);
    if (state !== "Requested") {
      return;
    }
    // 1. Validation
    this._options._host = this._device.getValue(`${path}.Host`);
    if (!this._options._host || this._options._host.length > 256) {
      this._device.set(`${path}.DiagnosticsState`, "Error_CannotResolveHostName");
      return;
    }

    this._options._maxHopCount = parseInt(this._device.getValue(`${path}.MaxHopCount`) || '30');
    this._options._timeout = parseInt(this._device.getValue(`${path}.Timeout`) || '1000');

    if (this._options._maxHopCount < 1 || this._options._maxHopCount > 64 || this._options._timeout < 1) {
      this._device.set(`${path}.DiagnosticsState`, "Error_MaxHopCountExceeded"); // Or Error_Other
      return;
    }

    this._isRequested = true;
    this._device.addTask(this);
  }

  /**
   * Executes the system traceroute command and parses the output to populate hop results.
   */
  run() {
    if (!this._isRequested) return;
    this._device._log.debug(`[${this._type}] run requested`);
    this._isRequested = false;
    this._isRunning = true;

    this._device._log.debug("Starting Traceroute Diagnostic...");
    const path = this._key;
    const hopPrefix = this._device._rootName === "Device" ? '' : 'Hop';

    // 2. Execution (platform-aware: win32 / linux / darwin)
    const cmd = tracerouteCommand({
      host: this._options._host,
      maxHopCount: this._options._maxHopCount,
      timeout: this._options._timeout,
    });
    this._device._log.debug(`Executing: ${cmd}`);

    this._device.set(`${path}.DiagnosticsState`, "Requested"); // While running

    exec(cmd, (error, stdout, stderr) => {
      this._device._log.debug("Traceroute Output:\n", stdout);

      // 3. Parsing Results
      this._result._hopCount = 0;
      this._result._lastResponseTime = 0;

      for (const hop of parseTracerouteHops(stdout)) {
        this._result._hopCount++;
        const hopPath = `${path}.RouteHops.${hop.hop}`;
        const errorCode = hop.times.every((t) => t === 0) ? '1' : '0';
        // Update device model for this hop
        this._device.set(`${hopPath}.${hopPrefix}Host`, hop.ip, true);
        this._device.set(`${hopPath}.${hopPrefix}HostAddress`, hop.ip, true);
        this._device.set(`${hopPath}.${hopPrefix}ErrorCode`, errorCode, true);
        this._device.set(`${hopPath}.${hopPrefix}RTTimes`, hop.times.join(','), true);

        this._result._lastResponseTime = Math.max(...hop.times, this._result._lastResponseTime);
      }

      this.finish();
    });
  }

  /**
   * Updates the device model with traceroute results and marks diagnostics as complete.
   */
  finish() {
    this._device._log.debug(`Task [${this._type}] Complete:`, this._result);
    this._device.set(`${this._key}.DiagnosticsState`, "Complete", true);
    this._device.set(`${this._key}.RouteHopsNumberOfEntries`, `${this._result._hopCount}`, true);
    this._device.set(`${this._key}.ResponseTime`, `${this._result._lastResponseTime}`, true);
    this._device.finishTask(this);
  }
}
