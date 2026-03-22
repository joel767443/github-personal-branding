const { LinkedInPostPayload } = require('../social/payloads/LinkedInPostPayload');
const { postFacebook } = require('./postFacebook');
const { postTwitter } = require('./postTwitter');

/** Platform-specific implementations; each owns auth, payload shape, and API calls. */
const PLATFORM_POSTERS = {
  facebook: postFacebook,
  twitter: postTwitter,
};

/**
 * @param {object} args
 * @param {number} args.developerId
 * @param {string} args.platform `facebook` | `twitter` | `linkedin`
 * @param {Record<string, unknown>} args.payload Platform-specific plain object (from job JSON).
 * @returns {Promise<Record<string, unknown>>}
 */
async function executeSocialMediaPost({ developerId, platform, payload }) {
  const id = Number(developerId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('executeSocialMediaPost: invalid developerId');
  }
  const p = String(platform ?? '').toLowerCase();
  const run = PLATFORM_POSTERS[p];
  if (run) {
    return run(id, payload ?? {});
  }
  if (p === 'linkedin') {
    new LinkedInPostPayload(payload ?? {}).toApiBody();
  }
  throw new Error(`executeSocialMediaPost: unknown platform "${platform}"`);
}

module.exports = {
  executeSocialMediaPost,
  postFacebook,
  postTwitter,
};
