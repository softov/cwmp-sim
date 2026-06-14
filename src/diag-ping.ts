
import { exec } from "child_process";
import CWMPTask from "./cwmp-task.ts";
import CWMPDevice from "./cwmp-device.ts";

/**
 * Task implementation for IP Ping Diagnostics.
 */
export default class DiagPing extends CWMPTask {
  _type = "diag-ping";
  _options = {
    _host: "",
    _repetitions: 0,
    _timeout: 0,
    _dataBlockSize: 0,
  };
  _result = {
    _host: "",
    _successCount: 0,
    _failureCount: 0,
    _avgTime: 0,
    _minTime: 0,
    _maxTime: 0,
  };

  constructor(device: CWMPDevice) {
    super(device);
  }

  /**
   * Registers the listener for DiagnosticsState changes.
   */
  register() {
    this._key = this._device._rootName === "Device"
      ? "Device.IP.Diagnostics.IPPing"
      : "InternetGatewayDevice.IPPingDiagnostics";
    this._device.addListener(`${this._key}.DiagnosticsState`, (val: string) => {
      console.log(`${this._key}.DiagnosticsState changed ${val}`);
      this.dispatch();
    });
  }

  /**
   * Validates parameters and dispatches the ping task if requested.
   */
  dispatch() {
    const state = this._device.getValue(`${this._key}.DiagnosticsState`);
    if (state == "Complete") {
      return;
    }
    if (state == "None") {
      console.log(`DiagnosticsState not found`);
      return;
    }
    if (state !== "Requested") {
      console.log(`DiagnosticsState is not Requested, current state: ${state}`);
      return;
    }

    // 1. Validation
    this._options._host = this._device.getValue(`${this._key}.Host`);
    if (!this._options._host || this._options._host.length > 256) {
      console.log(`Host is not valid, current host: ${this._options._host}`);
      this._device.set(`${this._key}.DiagnosticsState`, "Error_CannotResolveHostName");
      return;
    }

    this._options._repetitions = parseInt(this._device.getValue(`${this._key}.NumberOfRepetitions`) || '3');
    this._options._timeout = parseInt(this._device.getValue(`${this._key}.Timeout`) || '1000');
    this._options._dataBlockSize = parseInt(this._device.getValue(`${this._key}.DataBlockSize`) || '32');

    if (this._options._repetitions < 1 || this._options._timeout < 1 || this._options._dataBlockSize < 1) {
      console.log(`Repetitions, timeout or dataBlockSize is not valid, current values: ${this._options._repetitions}, ${this._options._timeout}, ${this._options._dataBlockSize}`);
      this._device.set(`${this._key}.DiagnosticsState`, "Error_Other");
      return;
    }

    this._isRequested = true;
    this._device.addTask(this);
  }

  /**
   * Executes the system ping command and parses the output.
   */
  run() {
    if (!this._isRequested) return;
    console.log(`[${this._type}] run requested`);
    this._isRequested = false;
    this._isRunning = true;
    this._result._host = this._options._host;

    console.log("Starting Ping Diagnostic...");

    // 2. Execution (Windows ping syntax)
    // ping -n <count> -w <timeout> -l <size> <host>
    const cmd = `ping -n ${this._options._repetitions} -w ${this._options._timeout} -l ${this._options._dataBlockSize} ${this._options._host}`;
    console.log(`Executing: ${cmd}`);

    exec(cmd, (error, stdout, stderr) => {
      // 3. Parsing Results
      console.log("Ping Output:\n", stdout);

      this._result._successCount = 0;
      this._result._failureCount = 0;
      this._result._minTime = 0;
      this._result._maxTime = 0;
      this._result._avgTime = 0;

      const hostMatch = stdout.match(/\[(\d{1,3}(?:\.\d{1,3}){3})\]/);
      if (hostMatch) {
        this._result._host = hostMatch[1];
      }

      // Extract stats from Windows ping output
      // Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)
      const packetMatch = stdout.match(/Sent = (\d+), Received = (\d+), Lost = (\d+)/);
      if (packetMatch) {
        this._result._successCount = parseInt(packetMatch[2]);
        this._result._failureCount = parseInt(packetMatch[3]);
      } else {
        this._result._failureCount = this._options._repetitions;
      }

      // Minimum = 14ms, Maximum = 16ms, Average = 15ms
      const timeMatch = stdout.match(/Minimum = (\d+)ms, Maximum = (\d+)ms, Average = (\d+)ms/);
      if (timeMatch) {
        this._result._minTime = parseInt(timeMatch[1]);
        this._result._maxTime = parseInt(timeMatch[2]);
        this._result._avgTime = parseInt(timeMatch[3]);
      }

      console.log('Result:', this._result);

      this.finish();
    });
  }

  /**
   * Updates the device model with ping results and marks diagnostics as complete.
   */
  finish() {
    console.log(`Task [${this._type}] Complete:`, this._result);
    this._device.set(`${this._key}.Host`, `${this._result._host}`, true);
    this._device.set(`${this._key}.SuccessCount`, `${this._result._successCount}`, true);
    this._device.set(`${this._key}.FailureCount`, `${this._result._failureCount}`, true);
    this._device.set(`${this._key}.AverageResponseTime`, `${this._result._avgTime}`, true);
    this._device.set(`${this._key}.MinimumResponseTime`, `${this._result._minTime}`, true);
    this._device.set(`${this._key}.MaximumResponseTime`, `${this._result._maxTime}`, true);
    this._device.set(`${this._key}.DiagnosticsState`, "Complete", true);
    this._isRequested = false;
    this._isRunning = false;
    this._device.finishTask(this);
  }
}
