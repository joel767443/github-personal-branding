const { Queue } = require('bullmq');
const { createRedisConnection } = require('./redisConnection');

const connection = createRedisConnection();

const SYNC_QUEUE = 'sync-pipeline';
const LINKEDIN_QUEUE = 'linkedin-import';
const SOCIAL_MEDIA_QUEUE = 'social-media-post';

/** @type {import('bullmq').Queue | null} */
let syncQueue = null;
/** @type {import('bullmq').Queue | null} */
let linkedinQueue = null;
/** @type {import('bullmq').Queue | null} */
let socialMediaQueue = null;

if (connection) {
  syncQueue = new Queue(SYNC_QUEUE, { connection });
  linkedinQueue = new Queue(LINKEDIN_QUEUE, { connection });
  socialMediaQueue = new Queue(SOCIAL_MEDIA_QUEUE, { connection });
}

function queuesEnabled() {
  return Boolean(connection && syncQueue && linkedinQueue && socialMediaQueue);
}

module.exports = {
  connection,
  syncQueue,
  linkedinQueue,
  socialMediaQueue,
  SYNC_QUEUE,
  LINKEDIN_QUEUE,
  SOCIAL_MEDIA_QUEUE,
  queuesEnabled,
};
