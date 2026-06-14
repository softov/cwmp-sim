
import CWMPTask from "./cwmp-task.ts";
import CWMPDevice from "./cwmp-device.ts";
import { requestWithDigest } from "./cwmp-http.ts";

/**
 * Task implementation for Upload Diagnostics.
 * Performs actual HTTP uploads and measures performance metrics per TR-143.
 */
export default class DiagUpload extends CWMPTask {
  _type = "diag-upload";
  _options = {
    _url: "",
    _timeout: 0,
    _username: "",
    _password: "",
    _testFileLength: 1048576 // Default 1MB
  };
  _result = {
    _totalBytesSent: 0,
    _testBytesSent: 0,
    _totalBytesReceived: 0,
    _romTime: "",
    _bomTime: "",
    _eomTime: "",
    _faultCode: "",
    _faultString: ""
  };

  /**
   * Creates an instance of DiagUpload.
   * @param {CWMPDevice} device - The CWMP device associated with this task.
   */
  constructor(device: CWMPDevice) {
    super(device);
  }

  /**
   * Registers the listener for DiagnosticsState changes.
   */
  register() {
    this._key = this._device._rootName === "Device"
      ? "Device.IP.Diagnostics.UploadDiagnostics"
      : "InternetGatewayDevice.UploadDiagnostics";

    this._device.addListener(`${this._key}.DiagnosticsState`, (val) => {
      console.log(`${this._key}.DiagnosticsState changed ${val}`);
      this.dispatch();
    });
  }

  /**
   * Validates parameters and dispatches the upload diagnostic task if requested.
   */
  dispatch() {
    this._isRequested = false;
    const state = this._device.getValue(`${this._key}.DiagnosticsState`);
    if (state !== "Requested") {
      return;
    }
    this._options._url = this._device.getValue(`${this._key}.UploadURL`);
    if (!this._options._url || this._options._url.length > 2048) {
      this._device.set(`${this._key}.DiagnosticsState`, "Error_Other"); // Invalid URL
      this.finish();
      return;
    }

    this._options._timeout = parseInt(this._device.getValue(`${this._key}.Timeout`) || '30000');
    // There is no username and password in the TR-143
    // this._options._username = this._device.getValue(`${this._key}.Username`) || "";
    // this._options._password = this._device.getValue(`${this._key}.Password`) || "";

    // not supported for now 
    // this._options._interface = this._device.getValue(`${this._key}.Interface`) || "";

    // Read TestFileLength from device model (default to 1MB if not set)
    const testFileLength = parseInt(this._device.getValue(`${this._key}.TestFileLength`) || '0');
    this._options._testFileLength = testFileLength > 0 ? testFileLength : 1048576;

    this._isRequested = true;
    this._device.addTask(this);
  }

  /**
   * Performs the actual HTTP upload and measures performance.
   */
  run() {
    if (!this._isRequested) return;
    this._isRequested = false;
    this._isRunning = true;

    console.log(`Starting Upload Diagnostic: ${this._options._url} (${this._options._testFileLength} bytes)`);

    // Generate test data buffer
    const testData = Buffer.alloc(this._options._testFileLength, 0x41); // Fill with 'A'

    // ROMTime: Request sent time
    this._result._romTime = new Date().toISOString();

    // this._result._faultCode = "Error_InitConnectionFailed";
    // this._result._faultCode = "Error_NoResponse";
    // this._result._faultCode = "Error_Timeout";
    // this._result._faultCode = "Error_Internal";
    // this._result._faultCode = "Error_Other";

    requestWithDigest({
      method: "PUT",
      uri: this._options._url,
      username: this._options._username,
      password: this._options._password,
      body: testData
    }).then(({ res, body }) => {
      // BOMTime: Beginning of upload
      if (!this._result._bomTime) {
        this._result._bomTime = new Date().toISOString();
      }

      // EOMTime: End of upload
      this._result._eomTime = new Date().toISOString();

      if (!res || (res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204)) {
        console.error("Upload failed:", res?.statusCode);
        this._result._faultCode = "Error_TransferFailed";
        this._result._faultString = `HTTP ${res?.statusCode}`;
      } else {
        console.log(`Upload successful: ${testData.length} bytes sent`);

        // TestBytesSent: actual payload bytes
        this._result._testBytesSent = testData.length;

        // Estimate request header size (typical PUT request ~300-500 bytes)
        const requestHeaderSize = 400;
        this._result._totalBytesSent = this._result._testBytesSent + requestHeaderSize;

        // Estimate response bytes (headers + body)
        const responseHeaderSize = 300;
        this._result._totalBytesReceived = (body?.length || 0) + responseHeaderSize;

        this._result._faultCode = "";
        this._result._faultString = "";
      }
      this.finish();
    }).catch((err) => {
      console.error("Upload error:", err.message);
      this._result._eomTime = new Date().toISOString();
      this._result._faultCode = "Error_TransferFailed";
      this._result._faultString = err.message;
      this.finish();
    });
  }

  /**
   * Updates the device model with upload results and marks diagnostics as complete.
   */
  finish() {
    console.log(`Task [${this._type}] Complete:`, this._result);

    if (this._result._faultCode) {
      this._device.set(`${this._key}.DiagnosticsState`, this._result._faultCode, true);
    } else {
      this._device.set(`${this._key}.DiagnosticsState`, "Complete", true);
    }

    this._device.set(`${this._key}.TotalBytesSent`, `${this._result._totalBytesSent}`, true);
    this._device.set(`${this._key}.TestBytesSent`, `${this._result._testBytesSent}`, true);
    this._device.set(`${this._key}.TotalBytesReceived`, `${this._result._totalBytesReceived}`, true);
    this._device.set(`${this._key}.ROMTime`, this._result._romTime, true);
    this._device.set(`${this._key}.BOMTime`, this._result._bomTime, true);
    this._device.set(`${this._key}.EOMTime`, this._result._eomTime, true);

    this._device.finishTask(this);
  }
}
