const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { facebookGraphApiVersion } = require('../services/facebookOAuth');
const { FacebookPostPayload } = require('../social/payloads/FacebookPostPayload');

/**
 * Facebook Graph API posting for this app is **Page-only**: `POST /{page-id}/feed` with a Page access token.
 * Meta does not support creating posts on a **personal profile** timeline via `/{user-id}/feed` for third-party
 * apps (User Feed “Creating” is disallowed; `publish_actions` was removed). Do not add user-timeline POST here.
 *
 * @see https://developers.facebook.com/docs/graph-api/reference/user/feed/
 * @see https://developers.facebook.com/docs/graph-api/reference/page/feed/
 *
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
  if (json.error) {
    const msg = json.error.message || json.error.type || 'Graph API error';
    throw new Error(`Facebook: ${msg}`);
  }
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

module.exports = { postFacebook };
