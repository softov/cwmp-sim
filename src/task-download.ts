
import { requestWithDigest } from "./cwmp-http.ts";
import CWMPDevice from "./cwmp-device.ts";
import xmlUtils from "./xml-utils.ts";
import xmlParser from "./xml-parser.ts";
import CWMPTask from "./cwmp-task.ts";

type TaskDownloadOptions = {
  url: string;
  commandKey: string;
  username: string;
  password: string;
  delay: number;
  fileType: string;
};

/**
 * Task implementation for handling file downloads (Firmware Upgrade, etc.).
 */
export default class TaskDownload extends CWMPTask {
  _type = "task-download";
  _options: TaskDownloadOptions = {
    url: "",
    commandKey: "",
    username: "",
    password: "",
    delay: 0,
    fileType: ""
  };
  _result = {
    _faultCode: "",
    _faultString: "",
    _startTime: "",
    _completeTime: ""
  };


  constructor(device: CWMPDevice, options: TaskDownloadOptions) {
    super(device);
    this._options.url = options.url;
    this._options.commandKey = options.commandKey;
    this._options.username = options.username;
    this._options.password = options.password;
    this._options.delay = options.delay;
    this._options.fileType = options.fileType;
  }

  /**
   * No specific registration needed for immediate tasks.
   */
  register(): void { }

  /**
   * Dispatches the download task, respecting the optional delay.
   */
  dispatch(): void {
    this._device._log.debug(`[${this._type}] dispatch - delay ${this._options.delay}`);
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
   * Executes the download request.
   */
  run() {
    this._isRunning = true;
    this._device._log.debug(`[${this._type}] Type: [${this._options.fileType}] URL: [${this._options.url}] Key: [${this._options.commandKey}]`);
    this._result._startTime = new Date().toISOString();
    requestWithDigest({
      method: "GET",
      uri: this._options.url,
      username: this._options.username,
      password: this._options.password,
      logger: this._device._log,
    }).then(({ res, body }) => {
      if (!res || res.statusCode !== 200) {
        this._device._log.error("Download failed:", res?.statusCode);
        this._result._faultCode = "9010";
        this._result._faultString = "Download failed: " + res?.statusCode;
      } else {
        this._device._log.debug("Download successful.");
        this._result._faultCode = "0";
        this._result._faultString = "";
      }
      this._result._completeTime = new Date().toISOString();
      this.finish();
    }).catch((err) => {
      this._device._log.error("Download failed:", err.message);
      this._result._faultCode = "9010";
      this._result._faultString = "Download failed: " + err.message;
      this.finish();
    });
  }

  /**
   * finalizes the download task and queues the TransferComplete message.
   */
  finish() {
    this._device._log.debug(`Task [${this._type}] Complete:`, this._result);
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
