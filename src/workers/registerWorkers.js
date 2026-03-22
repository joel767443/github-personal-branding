const cron = require('node-cron');
const { Worker } = require('bullmq');
const prisma = require('../db/prisma');
const {
  connection,
  syncQueue,
  linkedinQueue,
  SYNC_QUEUE,
  LINKEDIN_QUEUE,
  SOCIAL_MEDIA_QUEUE,
  queuesEnabled,
} = require('../queue/jobQueues');
const { executeSyncPipeline } = require('../jobs/syncPipeline');
const { executeLinkedinImportPipeline } = require('../jobs/linkedinPipeline');
const { executeSocialMediaPost } = require('../jobs/executeSocialMediaPost');
const progressBus = require('../config/progressBus');
const {
  startJobRun,
  addJobEvent,
  completeJobRun,
  failJobRun,
} = require('../services/monitoringService');
const { addFrequencyToDate } = require('../services/syncFrequencyHelpers');

function makeProgress(runId, job) {
  return (label, extra = {}) => {
    progressBus.publish(label, { job, ...extra });
    addJobEvent({ runId, label, payload: extra ?? null }).catch(() => {});
  };
}

function registerWorkers() {
  if (!queuesEnabled() || !connection) {
    return;
  }

  new Worker(
    SYNC_QUEUE,
    async (job) => {
      const { runId, developerId, userLogin } = job.data;
      progressBus.start(runId, { job: 'sync', label: 'Sync started' });
      const onProgress = makeProgress(runId, 'sync');
      try {
        await executeSyncPipeline({
          developerId: developerId ?? null,
          onProgress,
          req: null,
        });
        progressBus.finish(true);
        await completeJobRun({ runId, summary: 'Sync pipeline complete' });
      } catch (err) {
        progressBus.finish(false, err?.message ?? String(err));
        await failJobRun({
          runId,
          message: err?.message ?? String(err),
          details: err?.response?.data ?? null,
          stack: err?.stack ?? null,
        });
        throw err;
      }
    },
    { connection, concurrency: Number(process.env.SYNC_QUEUE_CONCURRENCY || 3) },
  );

  new Worker(
    LINKEDIN_QUEUE,
    async (job) => {
      const { runId, developerId, zipPath } = job.data;
      progressBus.start(runId, { job: 'linkedin', label: 'LinkedIn import started' });
      const onProgress = makeProgress(runId, 'linkedin');
      try {
        const importResult = await executeLinkedinImportPipeline({
          developerId,
          zipPath,
          onProgress,
        });
        progressBus.finish(true, null, {
          job: 'linkedin',
          import: importResult.stats,
        });
        await completeJobRun({
          runId,
          summary: 'LinkedIn import complete',
          metadata: importResult.stats,
        });
      } catch (err) {
        progressBus.finish(false, err?.message ?? String(err), { job: 'linkedin' });
        await failJobRun({
          runId,
          message: err?.message ?? String(err),
          details: err?.response?.data ?? null,
          stack: err?.stack ?? null,
        });
        throw err;
      }
    },
    { connection, concurrency: Number(process.env.LINKEDIN_QUEUE_CONCURRENCY || 2) },
  );

  new Worker(
    SOCIAL_MEDIA_QUEUE,
    async (job) => {
      const { runId, developerId, platform, payload } = job.data ?? {};
      try {
        const result = await executeSocialMediaPost({
          developerId,
          platform,
          payload,
        });
        if (runId) {
          await completeJobRun({
            runId,
            summary: 'Social media post complete',
            metadata: result,
          });
        }
        return result;
      } catch (err) {
        if (runId) {
          await failJobRun({
            runId,
            message: err?.message ?? String(err),
            details: err?.response?.data ?? null,
            stack: err?.stack ?? null,
          });
        }
        throw err;
      }
    },
    {
      connection,
      concurrency: Number(process.env.SOCIAL_MEDIA_QUEUE_CONCURRENCY || 2),
    },
  );

  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const due = await prisma.developer.findMany({
        where: {
          nextScheduledSyncAt: { lte: now },
          OR: [
            { subscriptionStatus: null },
            { subscriptionStatus: 'active' },
            { subscriptionStatus: 'trialing' },
          ],
        },
      });
      for (const d of due) {
        if (!d.githubUsername && !d.githubLogin) continue;
        const runId = `run_scheduled_${Date.now()}_${d.id}`;
        progressBus.start(runId, { job: 'sync', label: 'Scheduled sync started' });
        await startJobRun({
          runId,
          jobType: 'sync',
          userLogin: d.githubLogin ?? d.githubUsername ?? null,
          developerId: d.id,
        });
        await syncQueue.add(
          'scheduled',
          {
            runId,
            developerId: d.id,
            userLogin: d.githubLogin ?? d.githubUsername,
          },
          { jobId: runId },
        );
        const next = addFrequencyToDate(now, d.syncFrequency);
        await prisma.developer.update({
          where: { id: d.id },
          data: { nextScheduledSyncAt: next, lastScheduledSyncAt: now },
        });
      }
    } catch (e) {
      console.error('Scheduled sync cron error:', e?.message ?? e);
    }
  });

  console.log(
    'BullMQ workers registered (same process):',
    SYNC_QUEUE,
    LINKEDIN_QUEUE,
    SOCIAL_MEDIA_QUEUE,
  );
}

module.exports = { registerWorkers };
