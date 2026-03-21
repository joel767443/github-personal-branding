const IORedis = require('ioredis');

/**
 * @returns {InstanceType<typeof IORedis> | null}
 */
function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url || !String(url).trim()) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: null,
  });
}

module.exports = {
  createRedisConnection,
};
