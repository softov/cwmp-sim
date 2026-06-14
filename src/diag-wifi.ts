
import CWMPTask from "./cwmp-task.ts";
import CWMPDevice from "./cwmp-device.ts";

/**
 * Task implementation for WiFi Diagnostics (Simulated).
 */
export default class DiagWifi extends CWMPTask {
  _type = "diag-wifi";
  _options = {};
  _result = {};

  constructor(device: CWMPDevice) {
    super(device);
  }

  /**
   * Registers the listener for DiagnosticsState changes.
   */
  register() {
    this._key = this._device._rootName === "Device"
      ? "Device.WiFi.NeighboringWiFiDiagnostic"
      : "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.NeighboringWiFiDiagnostic";

    this._device.addListener(`${this._key}.DiagnosticsState`, (val) => {
      console.log(`${this._key}.DiagnosticsState changed ${val}`);
      this.dispatch();
    });
  }

  /**
   * Dispatches the WiFi diagnostic task if requested.
   */
  dispatch() {
    const state = this._device.getValue(`${this._key}.DiagnosticsState`);
    if (state !== "Requested") {
      return;
    }
    this._isRequested = true;
    this._device.addTask(this);
  }

  /**
   * Simulates the WiFi diagnostic process (with a delay).
   */
  run() {
    console.log(`[${this._type}] run requested`);
    if (!this._isRequested) return;
    this._isRequested = false;
    this._isRunning = true;

    console.log("Starting WiFi Diagnostic (Simulated)...");

    setTimeout(() => {
      this.finish();
    }, 2500);
  }

  /**
   * Updates the device model with simulated WiFi results and marks diagnostics as complete.
   */
  finish(): void {
    console.log(`Task [${this._type}] Complete:`, this._result);
    this._device.set(`${this._key}.DiagnosticsState`, "Complete");
    this._device.set(`${this._key}.ResultNumberOfEntries`, "2");

    this._device.set(`${this._key}.Result.1.SSID`, "Neighbor1");
    this._device.set(`${this._key}.Result.1.SignalStrength`, "-50");
    this._device.set(`${this._key}.Result.1.Channel`, "6");

    this._device.set(`${this._key}.Result.2.SSID`, "Neighbor2");
    this._device.set(`${this._key}.Result.2.SignalStrength`, "-80");
    this._device.set(`${this._key}.Result.2.Channel`, "11");
    this._device.finishTask(this);
  }
}
