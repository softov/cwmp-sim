
import { exec } from "child_process";
import CWMPTask from "./cwmp-task.ts";
import CWMPDevice from "./cwmp-device.ts";

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
      console.log(`${this._key}.DiagnosticsState changed ${val}`);
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
    console.log(`[${this._type}] run requested`);
    this._isRequested = false;
    this._isRunning = true;

    console.log("Starting Traceroute Diagnostic...");
    const path = this._key;
    const hopPrefix = this._device._rootName === "Device" ? '' : 'Hop';

    // 2. Execution (Windows tracert syntax)
    // tracert -h <max_hops> -w <timeout> -d <host> (-d to verify no DNS resolution if not requested, but usually standard is fine)
    // -d prevents reverse DNS lookup which speeds it up
    const cmd = `tracert -h ${this._options._maxHopCount} -w ${this._options._timeout} -d ${this._options._host}`;
    console.log(`Executing: ${cmd}`);

    this._device.set(`${path}DiagnosticsState`, "Requested"); // While running

    exec(cmd, (error, stdout, stderr) => {
      console.log("Traceroute Output:\n", stdout);

      // 3. Parsing Results
      const lines = stdout.split('\n');
      this._result._hopCount = 0;
      this._result._lastResponseTime = 0;

      // Clear old hops
      // Note: In a real efficient implementation we would clear only if size changed or overwrite
      // Here we assume we just set the new ones.

      const hopRegex = /^\s*(\d+)\s+((?:<1|\d+)\s*ms|\*)\s+((?:<1|\d+)\s*ms|\*)\s+((?:<1|\d+)\s*ms|\*)\s+(.+)$/;

      lines.forEach(line => {
        line = line.trim();
        const match = line.match(hopRegex);
        if (match) {
          this._result._hopCount++;
          const hopNum = parseInt(match[1]);
          const hopPath = `${path}.RouteHops.${hopNum}`;
          const rtt1 = match[2];
          const rtt2 = match[3];
          const rtt3 = match[4];
          const hopIp = match[5].trim();
          // Convert times to numbers, treat * as 0 or handle error
          const parseRtt = (t) => (t === '*' ? 0 : (t === '<1' ? 0 : parseInt(t)));
          const times = [parseRtt(rtt1), parseRtt(rtt2), parseRtt(rtt3)];
          const errorCode = times.every((t: number) => (t === 0)) ? '1' : '0';
          // Update device model for this hop
          this._device.set(`${hopPath}.${hopPrefix}Host`, hopIp, true);
          this._device.set(`${hopPath}.${hopPrefix}HostAddress`, hopIp, true); // Windows tracert -d gives IP
          this._device.set(`${hopPath}.${hopPrefix}ErrorCode`, errorCode, true); // 1 for defined error? TR-069 doesn't specify simple ICMP error mapping clearly here, usually 0 is fine
          this._device.set(`${hopPath}.${hopPrefix}RTTimes`, times.join(','), true);

          this._result._lastResponseTime = Math.max(...times);
        }
      });

      this.finish();
    });
  }

  /**
   * Updates the device model with traceroute results and marks diagnostics as complete.
   */
  finish() {
    console.log(`Task [${this._type}] Complete:`, this._result);
    this._device.set(`${this._key}.DiagnosticsState`, "Complete", true);
    this._device.set(`${this._key}.RouteHopsNumberOfEntries`, `${this._result._hopCount}`, true);
    this._device.set(`${this._key}.ResponseTime`, `${this._result._lastResponseTime}`, true);
    this._device.finishTask(this);
  }
}
