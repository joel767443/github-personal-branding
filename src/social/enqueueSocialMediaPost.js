const crypto = require('crypto');
const { socialMediaQueue, queuesEnabled, SOCIAL_MEDIA_QUEUE } = require('../queue/jobQueues');
const { startJobRun } = require('../services/monitoringService');

/**
 * Enqueue a background job to post to Facebook, Twitter, or LinkedIn.
 * Always creates a `job_runs` row (unless you pass `runId` to join an existing run).
 * @param {object} opts
 * @param {number} opts.developerId
 * @param {'facebook'|'twitter'|'linkedin'} opts.platform
 * @param {Record<string, unknown>} opts.payload Serializable job payload (e.g. `{ message, link }` for Facebook).
 * @param {string} [opts.jobId] Optional BullMQ job id for deduplication.
 * @param {string} [opts.runId] Optional monitoring run id (default: generated unique id).
 * @returns {Promise<import('bullmq').Job | null>}
 */
async function enqueueSocialMediaPost({ developerId, platform, payload, jobId, runId }) {
  if (!queuesEnabled() || !socialMediaQueue) {
    throw new Error('Social media queue is not available (Redis / BullMQ disabled)');
  }
  const devId = Number(developerId);
  const rid =
    runId != null && String(runId).trim()
      ? String(runId).trim()
      : `social_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  await startJobRun({
    runId: rid,
    jobType: 'social_media',
    developerId: devId,
    metadata: { platform: String(platform).toLowerCase() },
  });
  const data = {
    developerId: devId,
    platform: String(platform).toLowerCase(),
    payload: payload && typeof payload === 'object' ? payload : {},
    runId: rid,
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
