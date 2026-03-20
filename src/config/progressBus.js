const { EventEmitter } = require("events");

class ProgressBus {
  constructor() {
    this.emitter = new EventEmitter();
    this.currentRunId = null;
    this.lastEvents = [];
    this.maxEvents = 200;
    this.running = false;
  }

  /**
   * @param {string} runId
   * @param {{ label?: string, job?: string }} [opts]
   */
  start(runId, opts = {}) {
    this.currentRunId = runId;
    this.running = true;
    this.lastEvents = [];
    const label = opts.label ?? "Sync started";
    const job = opts.job ?? "sync";
    this.publish(label, { type: "start", job });
  }

  publish(label, extra = {}) {
    if (!this.currentRunId) return;
    const event = {
      runId: this.currentRunId,
      label,
      at: new Date().toISOString(),
      ...extra,
    };
    this.lastEvents.push(event);
    if (this.lastEvents.length > this.maxEvents) {
      this.lastEvents.shift();
    }
    this.emitter.emit("progress", event);
  }

  /**
   * @param {boolean} ok
   * @param {string} [errorMessage]
   * @param {{ job?: string, import?: object, filename?: string }} [extra]
   */
  finish(ok, errorMessage, extra = {}) {
    if (!this.currentRunId) return;
    const job = extra.job ?? "sync";
    if (ok) {
      const label = job === "linkedin" ? "LinkedIn import complete" : "Sync complete";
      this.publish(label, {
        type: "done",
        job,
        import: extra.import,
        filename: extra.filename,
      });
    } else {
      const label = job === "linkedin" ? "LinkedIn import failed" : "Sync failed";
      this.publish(label, {
        type: "error",
        job,
        error: errorMessage ?? "Unknown error",
      });
    }
    this.running = false;
  }

  subscribe(handler) {
    this.emitter.on("progress", handler);
    return () => this.emitter.off("progress", handler);
  }
}

module.exports = new ProgressBus();

