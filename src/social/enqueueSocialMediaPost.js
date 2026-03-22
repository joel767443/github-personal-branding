const { socialMediaQueue, queuesEnabled, SOCIAL_MEDIA_QUEUE } = require('../queue/jobQueues');
const { startJobRun } = require('../services/monitoringService');

/**
 * Enqueue a background job to post to Facebook, Twitter, or LinkedIn.
 * @param {object} opts
 * @param {number} opts.developerId
 * @param {'facebook'|'twitter'|'linkedin'} opts.platform
 * @param {Record<string, unknown>} opts.payload Serializable job payload (e.g. `{ message, link }` for Facebook).
 * @param {string} [opts.jobId] Optional BullMQ job id for deduplication.
 * @param {string} [opts.runId] Optional monitoring run id (creates `job_runs` row and worker completes/fails it).
 * @returns {Promise<import('bullmq').Job | null>}
 */
async function enqueueSocialMediaPost({ developerId, platform, payload, jobId, runId }) {
  if (!queuesEnabled() || !socialMediaQueue) {
    throw new Error('Social media queue is not available (Redis / BullMQ disabled)');
  }
  const devId = Number(developerId);
  const rid = runId ? String(runId) : null;
  if (rid) {
    await startJobRun({
      runId: rid,
      jobType: 'social_media',
      developerId: devId,
      metadata: { platform: String(platform).toLowerCase() },
    });
  }
  const data = {
    developerId: devId,
    platform: String(platform).toLowerCase(),
    payload: payload && typeof payload === 'object' ? payload : {},
    ...(rid ? { runId: rid } : {}),
  };
  return socialMediaQueue.add(
    'social-post',
    data,
    jobId ? { jobId: String(jobId) } : undefined,
  );
}

module.exports = {
  enqueueSocialMediaPost,
  SOCIAL_MEDIA_QUEUE,
};
