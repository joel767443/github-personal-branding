const { EventEmitter } = require("events");

/**
 * In-process SSE progress stream. Events are scoped by `developerId` so one account
 * cannot read another’s replay buffer or live updates.
 */
class ProgressBus {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.currentRunId = null;
    this.currentDeveloperId = null;
    /** @type {Map<number, object[]>} */
    this.eventsByDeveloper = new Map();
    this.maxEvents = 200;
    this.running = false;
  }

  /**
   * @param {string} runId
   * @param {{ label?: string, job?: string, developerId?: number | null }} [opts]
   */
  start(runId, opts = {}) {
    this.currentRunId = runId;
    const raw = opts.developerId;
    this.currentDeveloperId = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
    this.running = true;
    if (this.currentDeveloperId != null) {
      this.eventsByDeveloper.set(this.currentDeveloperId, []);
    }
    const label = opts.label ?? "Sync started";
    const job = opts.job ?? "sync";
    this.publish(label, { type: "start", job });
  }

  publish(label, extra = {}) {
    if (!this.currentRunId) return;
    const event = {
      runId: this.currentRunId,
      developerId: this.currentDeveloperId,
      label,
      at: new Date().toISOString(),
      ...extra,
    };
    const devId = this.currentDeveloperId;
    if (devId != null) {
      let arr = this.eventsByDeveloper.get(devId) ?? [];
      arr.push(event);
      if (arr.length > this.maxEvents) arr.shift();
      this.eventsByDeveloper.set(devId, arr);
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

  /**
   * @param {number} developerId
   */
  lastEventsFor(developerId) {
    const id = Number(developerId);
    if (!Number.isFinite(id)) return [];
    return this.eventsByDeveloper.get(id) ?? [];
  }

  /**
   * @param {number} developerId
   * @param {(event: object) => void} handler
   */
  subscribeForDeveloper(developerId, handler) {
    const id = Number(developerId);
    if (!Number.isFinite(id)) {
      return () => {};
    }
    const wrapped = (event) => {
      if (event.developerId !== id) return;
      handler(event);
    };
    this.emitter.on("progress", wrapped);
    return () => this.emitter.off("progress", wrapped);
  }
}

module.exports = new ProgressBus();
