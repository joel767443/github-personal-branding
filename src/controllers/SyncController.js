const fs = require("fs");
const path = require("path");
const { executeSyncPipeline } = require("../jobs/syncPipeline");
const { executeLinkedinImportPipeline } = require("../jobs/linkedinPipeline");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { assertCanRunPaidJobs } = require("../services/subscriptionAccess");
const { syncQueue, linkedinQueue, queuesEnabled } = require("../queue/jobQueues");
const { startJobRun, addJobEvent, completeJobRun, failJobRun } = require("../services/monitoringService");
const progressBus = require("../config/progressBus");
const { respondError } = require("../utils/httpErrors");
const { linkedinExportZipPath } = require("../config/uploadsDir");

class SyncController {
  constructor() {
    this.syncInProgress = false;
    this.linkedinInProgress = false;
  }

  async syncProgress(req, res) {
    const { developer } = await resolveDeveloperFromSession(req);
    if (!developer) return res.status(401).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const history = progressBus.lastEventsFor(developer.id);
    for (const h of history) send(h);

    const unsubscribe = progressBus.subscribeForDeveloper(developer.id, send);

    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  }

  async startSync(req, res) {
    const started = await this.runSyncPipelineInternal(req);
    if (!started.started) {
      if (started.reason === "subscription") {
        return respondError(res, 402, "Subscription required", started.message);
      }
      return respondError(res, 409, "Busy", started.reason);
    }
    res.json({ ok: true, runId: started.runId, queued: Boolean(started.queued) });
  }

  async runSyncPipelineInternal(req) {
    const { developer, login: sessionLogin } = await resolveDeveloperFromSession(req);
    const developerId = developer?.id ?? null;
    const login = sessionLogin ?? null;
    
    try {
      await assertCanRunPaidJobs(developerId);
    } catch (err) {
      // If developer doesn't exist yet, we allow the first sync (trialing)
      if (developerId !== null) {
        return { started: false, reason: "subscription", message: err.message };
      }
    }

    const runId = `run_${Date.now()}`;
    if (queuesEnabled()) {
      await startJobRun({ runId, jobType: "sync", userLogin: login, developerId });
      await syncQueue.add("sync", { runId, developerId, userLogin: login }, { jobId: runId });
      return { started: true, runId, queued: true };
    }

    if (this.syncInProgress) return { started: false, reason: "already_running" };

    this.syncInProgress = true;
    progressBus.start(runId, { job: "sync", label: "Sync started", developerId });
    await startJobRun({ runId, jobType: "sync", userLogin: login, developerId });

    (async () => {
      try {
        await executeSyncPipeline({
          developerId,
          req,
          onProgress: (label, extra) => {
            progressBus.publish(label, extra);
            addJobEvent({ runId, label, payload: extra }).catch(() => {});
          },
        });
        await completeJobRun({ runId, summary: "Sync complete" });
        progressBus.finish(true);
      } catch (err) {
        await failJobRun({ runId, message: err.message, stack: err.stack });
        progressBus.finish(false, err.message);
      } finally {
        this.syncInProgress = false;
      }
    })();

    return { started: true, runId };
  }

  async uploadLinkedin(req, res) {
    if (!req.file) return respondError(res, 400, "No file", "Select a ZIP file");
    const { developer, login: sessionLogin } = await resolveDeveloperFromSession(req);
    const login = sessionLogin ?? null;

    if (!developer) {
      // For initial setup, we can trigger sync first if GITHUB_TOKEN is available.
      // But usually user should have synced. Let's make it easier.
      // If no developer, we still need a developer ID to save the zip.
      // We can't easily proceed without developerId.
      return respondError(res, 404, "No developer record", "Please click 'Start Sync' first to initialize your profile.");
    }

    try {
      await assertCanRunPaidJobs(developer.id);
    } catch (err) {
      return respondError(res, 402, "Subscription required", err.message);
    }

    const runId = `linkedin_${Date.now()}`;
    const dest = linkedinExportZipPath(developer.id);
    fs.writeFileSync(dest, req.file.buffer);

    if (queuesEnabled()) {
      await startJobRun({ runId, jobType: "linkedin", userLogin: login, developerId: developer.id });
      await linkedinQueue.add("linkedin", {
        runId, developerId: developer.id, zipPath: dest, userLogin: login,
        nextSyncRunId: `run_${Date.now()}_after_linkedin`
      }, { jobId: runId });
      return res.json({ ok: true, runId, queued: true });
    }

    if (this.linkedinInProgress) return respondError(res, 409, "Busy", "Import in progress");

    this.linkedinInProgress = true;
    progressBus.start(runId, { job: "linkedin", label: "LinkedIn import started", developerId: developer.id });
    await startJobRun({ runId, jobType: "linkedin", userLogin: login, developerId: developer.id });

    res.json({ ok: true, runId, started: true });

    (async () => {
      try {
        const result = await executeLinkedinImportPipeline({
          zipPath: dest, developerId: developer.id,
          onProgress: (label, extra) => {
            progressBus.publish(label, { job: "linkedin", ...extra });
            addJobEvent({ runId, label, payload: extra }).catch(() => {});
          }
        });
        await completeJobRun({ runId, summary: "LinkedIn import complete", metadata: result.stats });
        progressBus.finish(true);
        await this.runSyncPipelineInternal(req);
      } catch (err) {
        await failJobRun({ runId, message: err.message, stack: err.stack });
        progressBus.finish(false, err.message);
      } finally {
        this.linkedinInProgress = false;
      }
    })();
  }
}

module.exports = new SyncController();
