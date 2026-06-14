
import CWMPDevice from "./cwmp-device.ts";

/**
 * Base class for CWMP tasks (Diagnostics, Downloads, Uploads, etc.)
 */
export default abstract class CWMPTask {
  _device: CWMPDevice;
  _key: string;
  _isRequested: boolean = false;
  _isRunning: boolean = false;
  _timeoutId?: NodeJS.Timeout;
  abstract _type: string;
  abstract _options: any;
  abstract _result: any;

  constructor(device: CWMPDevice) {
    this._device = device;
    this.register();
  }

  /**
   * Registers listeners or initializes task-specific logic.
   * Called in constructor.
   */
  abstract register(): void;

  /**
   * Dispatches the task execution.
   * Checks conditions (like DiagnosticsState change) and prepares to run.
   */
  abstract dispatch(): void;

  /**
   * Executes the main logic of the task.
   * Should set _isRunning to true.
   */
  abstract run(): void;

  /**
   * Finishes the task, updates state, and cleans up.
   * Should set _isRunning and _isRequested to false and call device.finishTask().
   */
  abstract finish(): void;
}
