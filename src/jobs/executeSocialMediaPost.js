const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { facebookGraphApiVersion } = require('../services/facebookOAuth');
const { FacebookPostPayload } = require('../social/payloads/FacebookPostPayload');
const { TwitterPostPayload } = require('../social/payloads/TwitterPostPayload');
const { LinkedInPostPayload } = require('../social/payloads/LinkedInPostPayload');

/**
 * @param {number} developerId
 * @param {FacebookPostPayload | Record<string, unknown>} payload
 */
async function postFacebook(developerId, payload) {
  const fb =
    payload instanceof FacebookPostPayload ? payload : new FacebookPostPayload(payload);

  const row = await prisma.developerFacebookAuthData.findUnique({
    where: { developerId },
  });
  if (!row?.pageAccessTokenEnc) {
    throw new Error('Facebook: no page token saved for this developer');
  }

  let pageToken;
  try {
    pageToken = decryptField(row.pageAccessTokenEnc);
  } catch (e) {
    throw new Error(`Facebook: could not decrypt page token (${e?.message ?? e})`);
  }
  if (!pageToken) {
    throw new Error('Facebook: empty page token after decrypt');
  }

  const version = facebookGraphApiVersion();
  const pageId = encodeURIComponent(String(row.facebookPageId).trim());
  const url = `https://graph.facebook.com/${version}/${pageId}/feed`;

  const fields = fb.toFeedFormFields();
  const body = new URLSearchParams();
  body.set('access_token', pageToken);
  for (const [k, v] of Object.entries(fields)) {
    body.set(k, v);
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error?.message || json?.error_msg || resp.statusText || 'Graph API error';
    throw new Error(`Facebook: ${msg}`);
  }

  await prisma.developerFacebookAuthData.update({
    where: { developerId },
    data: { lastPostedAt: new Date() },
  });

  return { platform: 'facebook', postId: json.id ?? null, success: true };
}

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
  if (p === 'facebook') {
    return postFacebook(id, payload ?? {});
  }
  if (p === 'twitter') {
    new TwitterPostPayload(payload ?? {}).toApiBody();
    return { platform: 'twitter', skipped: true };
  }
  if (p === 'linkedin') {
    new LinkedInPostPayload(payload ?? {}).toApiBody();
    return { platform: 'linkedin', skipped: true };
  }
  throw new Error(`executeSocialMediaPost: unknown platform "${platform}"`);
}

module.exports = {
  executeSocialMediaPost,
  postFacebook,
};
