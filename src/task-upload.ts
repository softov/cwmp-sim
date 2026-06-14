
import * as fs from "fs";
import { requestWithDigest } from "./cwmp-http.ts";
import CWMPDevice from "./cwmp-device.ts";
import xmlUtils from "./xml-utils.ts";
import xmlParser from "./xml-parser.ts";
import CWMPTask from "./cwmp-task.ts";

const FILETYPE_MAP: Record<string, { path: string; contentType: string }> = {
  // TR-069 Standard File Types
  "1 Firmware Upgrade Image": {
    path: "./sample/firmware.bin",
    contentType: "application/octet-stream"
  },
  "2 Web Content": {
    path: "./sample/web-content.tar",
    contentType: "application/x-tar"
  },
  "3 Vendor Configuration File": {
    path: "./sample/vendor-config.xml",
    contentType: "text/xml"
  },
  "4 Vendor Log File": {
    path: "./sample/vendor-log.txt",
    contentType: "text/plain"
  },
  // Common BroadBand Forum extensions (TR-157/TR-106) often use X <OUI> <Type>
  // We will handle these dynamically in logic if not explicitly found here.
};

type TaskUploadOptions = {
  url: string;
  commandKey: string;
  fileType: string;
  username: string;
  password: string;
  delay: number;
};

/**
 * Task implementation for handling file uploads (Backup, Log upload, etc.).
 * Supports TR-069, TR-157, TR-106, and Broadband extensions.
 */
export default class TaskUpload extends CWMPTask {
  _type = "task-upload";
  _options: TaskUploadOptions = {
    url: "",
    commandKey: "",
    fileType: "",
    username: "",
    password: "",
    delay: 0
  };
  _result = {
    _faultCode: "",
    _faultString: "",
    _startTime: "",
    _completeTime: ""
  };

  constructor(device: CWMPDevice, options: TaskUploadOptions) {
    super(device);
    this._options.url = options.url;
    this._options.commandKey = options.commandKey;
    this._options.fileType = options.fileType;
    this._options.username = options.username;
    this._options.password = options.password;
    this._options.delay = options.delay;
  }

  /**
   * No specific registration needed for immediate tasks.
   */
  register(): void { }

  /**
   * Dispatches the upload task, respecting the optional delay.
   */
  dispatch(): void {
    console.log(`[${this._type}] dispatch - delay ${this._options.delay}`);
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }
    this._isRequested = true;
    this._timeoutId = setTimeout(() => {
      this._timeoutId = undefined;
      this.run();
    }, (this._options.delay * 1000) || 1000);
  }

  /**
   * Executes the upload request.
   * Reads file from local FS based on FileType and performs HTTP PUT.
   */
  run() {
    this._isRunning = true;
    console.log(`[${this._type}] Type: [${this._options.fileType}] URL: [${this._options.url}] Key: [${this._options.commandKey}]`);
    this._result._startTime = new Date().toISOString();

    if (!this._options.fileType) {
      console.error(`Missing FileType`);
      this._result._faultCode = "9010";
      this._result._faultString = "Missing FileType";
      this._result._completeTime = new Date().toISOString();
      this.finish();
      return;
    }

    let fileInfo = FILETYPE_MAP[this._options.fileType];

    // Handle Vendor Extensions (X <OUI> ...) or unknown, map to generic vendor file
    if (!fileInfo) {
      if (this._options.fileType.startsWith("X ") || this._options.fileType.startsWith("X_")) {
        console.log(`Mapping unknown vendor type '${this._options.fileType}' to generic vendor LOG file.`);
        fileInfo = FILETYPE_MAP["4 Vendor Log File"];
      }
    }

    if (!fileInfo) {
      console.error(`Unknown FileType: ${this._options.fileType}`);
      this._result._faultCode = "9010"; // Download failure (using same code for upload failure generally?) or 9011
      this._result._faultString = `Unknown FileType: ${this._options.fileType}`;
      this._result._completeTime = new Date().toISOString();
      this.finish();
      return;
    }

    fs.readFile(fileInfo.path, (err, data) => {
      if (err) {
        console.error(`Failed to read file: ${fileInfo.path}`, err);
        this._result._faultCode = "9010";
        this._result._faultString = `File read error: ${err.message}`;
        this._result._completeTime = new Date().toISOString();
        this.finish();
        return;
      }

      console.log(`Read ${data.length} bytes from ${fileInfo.path}. Uploading...`);

      requestWithDigest({
        method: "PUT",
        uri: this._options.url,
        username: this._options.username,
        password: this._options.password,
        body: data
      }).then(({ res, body }) => {
        if (!res || res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204) {
          // 201 Created, 204 No Content are also success for PUT sometimes
          console.error("Upload failed:", res?.statusCode);
          this._result._faultCode = "9010"; // Upload failure
          this._result._faultString = "Upload failed: " + res?.statusCode;
        } else {
          console.log("Upload successful.");
          this._result._faultCode = "0";
          this._result._faultString = "";
        }
        this._result._completeTime = new Date().toISOString();
        this.finish();
      }).catch((err) => {
        console.error("Upload failed:", err.message);
        this._result._faultCode = "9010";
        this._result._faultString = "Upload failed: " + err.message;
        this._result._completeTime = new Date().toISOString();
        this.finish();
      });
    });
  }

  /**
   * Finalizes the upload task and queues the TransferComplete message.
   */
  finish() {
    console.log(`Task [${this._type}] Complete:`, this._result);
    this._device.addMessage(() => {
      let faultStruct = xmlUtils.node("FaultStruct", {}, [
        xmlUtils.node("FaultCode", {}, this._result._faultCode),
        xmlUtils.node("FaultString", {}, xmlParser.encodeEntities(this._result._faultString))
      ]);
      this._device.setLastMethod('TransferComplete');
      let body = xmlUtils.node("cwmp:TransferComplete", {}, [
        xmlUtils.node("CommandKey", {}, this._options.commandKey),
        xmlUtils.node("StartTime", {}, this._result._startTime),
        xmlUtils.node("CompleteTime", {}, this._result._completeTime),
        faultStruct
      ]);
      return body;
    });
    this._device.finishTask(this);
  }
}
