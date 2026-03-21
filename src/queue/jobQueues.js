const { Queue } = require('bullmq');
const { createRedisConnection } = require('./redisConnection');

const connection = createRedisConnection();

const SYNC_QUEUE = 'sync-pipeline';
const LINKEDIN_QUEUE = 'linkedin-import';

/** @type {import('bullmq').Queue | null} */
let syncQueue = null;
/** @type {import('bullmq').Queue | null} */
let linkedinQueue = null;

if (connection) {
  syncQueue = new Queue(SYNC_QUEUE, { connection });
  linkedinQueue = new Queue(LINKEDIN_QUEUE, { connection });
}

function queuesEnabled() {
  return Boolean(connection && syncQueue && linkedinQueue);
}

module.exports = {
  connection,
  syncQueue,
  linkedinQueue,
  SYNC_QUEUE,
  LINKEDIN_QUEUE,
  queuesEnabled,
};
