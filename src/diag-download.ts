
import CWMPTask from "./cwmp-task.ts";
import CWMPDevice from "./cwmp-device.ts";
import { requestWithDigest } from "./cwmp-http.ts";

/**
 * Task implementation for Download Diagnostics.
 * Performs actual HTTP downloads and measures performance metrics per TR-143.
 */
export default class DiagDownload extends CWMPTask {
  _type = "diag-download";
  _options = {
    _url: "",
    _timeout: 0,
    _username: "",
    _password: ""
  };
  _result = {
    _totalBytesReceived: 0,
    _testBytesReceived: 0,
    _totalBytesSent: 0,
    _romTime: "",
    _bomTime: "",
    _eomTime: "",
    _faultCode: "",
    _faultString: ""
  };

  constructor(device: CWMPDevice) {
    super(device);
  }

  /**
   * Registers the listener for DiagnosticsState changes.
   */
  register() {
    this._key = this._device._rootName === "Device"
      ? "Device.IP.Diagnostics.DownloadDiagnostics"
      : "InternetGatewayDevice.DownloadDiagnostics";

    this._device.addListener(`${this._key}.DiagnosticsState`, (val: string) => {
      console.log(`${this._key}.DiagnosticsState changed ${val}`);
      this.dispatch();
    });
  }

  /**
   * Validates parameters and dispatches the download diagnostic task if requested.
   */
  dispatch() {
    this._isRequested = false;
    const state = this._device.getValue(`${this._key}.DiagnosticsState`);
    console.log(`${this._key}.DiagnosticsState dispatch ${state}`);
    if (state !== "Requested") {
      return;
    }
    this._options._url = this._device.getValue(`${this._key}.DownloadURL`);
    if (!this._options._url || this._options._url.length > 2048) {
      this._device.set(`${this._key}.DiagnosticsState`, "Error_Other"); // Invalid URL
      return;
    }

    this._options._timeout = parseInt(this._device.getValue(`${this._key}.Timeout`) || '30000');
    // There is no username and password in the TR-143
    // this._options._username = this._device.getValue(`${this._key}.Username`) || "";
    // this._options._password = this._device.getValue(`${this._key}.Password`) || "";

    this._isRequested = true;
    this._device.addTask(this);
  }

  /**
   * Performs the actual HTTP download and measures performance.
   */
  run() {
    if (!this._isRequested) return;
    console.log(`[${this._type}] run requested`);
    this._isRequested = false;
    this._isRunning = true;

    console.log(`Starting Download Diagnostic: ${this._options._url}`);

    // ROMTime: Request sent time
    this._result._romTime = new Date().toISOString();

    requestWithDigest({
      method: "GET",
      uri: this._options._url,
      username: this._options._username,
      password: this._options._password,
    }).then(({ res, body }) => {
      // BOMTime: Beginning of download
      if (!this._result._bomTime) {
        this._result._bomTime = new Date().toISOString();
      }

      // EOMTime: End of download
      this._result._eomTime = new Date().toISOString();

      if (!res || (res.statusCode !== 200 && res.statusCode !== 204 && res.statusCode !== 206)) {
        console.error("Download failed:", res?.statusCode);
        this._result._faultCode = "Error_TransferFailed";
        this._result._faultString = `HTTP ${res?.statusCode}`;
      } else if (res.statusCode === 204) {
        this._result._faultCode = "Error_TransferFailed";
        this._result._faultString = "HTTP 204";
      } else {
        console.log(`Download successful: ${body.length} bytes received`);

        // TestBytesReceived: actual payload bytes
        this._result._testBytesReceived = body.length;

        // Estimate request header size (typical GET request ~200-400 bytes)
        const requestHeaderSize = 300;
        this._result._totalBytesSent = requestHeaderSize;

        // Estimate response header size (typical ~400-600 bytes)
        const responseHeaderSize = 500;
        this._result._totalBytesReceived = this._result._testBytesReceived + responseHeaderSize;
        this._result._faultCode = "";
        this._result._faultString = "";
      }
      this.finish();
    }).catch((err) => {
      console.error("Download error:", err.message);
      this._result._eomTime = new Date().toISOString();
      this._result._faultCode = "Error_TransferFailed";
      this._result._faultString = err.message;
      this.finish();
    });
  }

  /**
   * Updates the device model with download results and marks diagnostics as complete.
   */
  finish() {
    console.log(`Task [${this._type}] Complete:`, this._result);

    if (this._result._faultCode) {
      this._device.set(`${this._key}.DiagnosticsState`, this._result._faultCode, true);
    } else {
      this._device.set(`${this._key}.DiagnosticsState`, "Complete", true);
    }

    this._device.set(`${this._key}.TotalBytesReceived`, `${this._result._totalBytesReceived}`, true);
    this._device.set(`${this._key}.TestBytesReceived`, `${this._result._testBytesReceived}`, true);
    this._device.set(`${this._key}.TotalBytesSent`, `${this._result._totalBytesSent}`, true);
    this._device.set(`${this._key}.ROMTime`, this._result._romTime, true);
    this._device.set(`${this._key}.BOMTime`, this._result._bomTime, true);
    this._device.set(`${this._key}.EOMTime`, this._result._eomTime, true);

    this._device.finishTask(this);
  }
}
