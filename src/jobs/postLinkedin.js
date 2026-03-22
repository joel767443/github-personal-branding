/**
 * LinkedIn REST posting: `POST https://api.linkedin.com/rest/posts` (member feed).
 * Requires OAuth token with `w_member_social` (or current equivalent) scope.
 *
 * `LINKEDIN_API_VERSION`: YYYYMM header value (default `202602`). Update if API returns version errors.
 *
 * @see https://learn.microsoft.com/en-us/linkedin/marketing/versioning
 */

const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { LinkedInPostPayload } = require('../social/payloads/LinkedInPostPayload');

const POSTS_URL = 'https://api.linkedin.com/rest/posts';

function linkedinApiVersion() {
  const v = process.env.LINKEDIN_API_VERSION;
  if (v && String(v).trim()) return String(v).trim();
  return '202602';
}

/**
 * @param {string} raw From DB (member id or full `urn:li:person:…`).
 * @returns {string} LinkedIn person URN
 */
function toPersonUrn(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.startsWith('urn:li:person:')) return s;
  return `urn:li:person:${s}`;
}

/**
 * @param {number} developerId
 * @param {LinkedInPostPayload | Record<string, unknown>} payload
 */
async function postLinkedin(developerId, payload) {
  const li =
    payload instanceof LinkedInPostPayload ? payload : new LinkedInPostPayload(payload);

  const row = await prisma.developer.findUnique({
    where: { id: developerId },
    select: { linkedinAccessTokenEnc: true, linkedinPersonId: true },
  });
  if (!row?.linkedinAccessTokenEnc) {
    throw new Error('LinkedIn: no access token saved for this developer');
  }
  const personId = String(row.linkedinPersonId ?? '').trim();
  if (!personId) {
    throw new Error('LinkedIn: no person id saved for this developer');
  }

  let accessToken;
  try {
    accessToken = decryptField(row.linkedinAccessTokenEnc);
  } catch (e) {
    throw new Error(`LinkedIn: could not decrypt access token (${e?.message ?? e})`);
  }
  if (!accessToken) {
    throw new Error('LinkedIn: empty access token after decrypt');
  }

  const author = toPersonUrn(personId);
  const body = {
    author,
    ...li.toApiBody(),
  };

  const version = linkedinApiVersion();
  const resp = await fetch(POSTS_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': version,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (resp.status !== 200 && resp.status !== 201) {
    const hint =
      json?.message ||
      json?.errorDetail ||
      json?.error ||
      text ||
      resp.statusText ||
      'LinkedIn API error';
    throw new Error(`LinkedIn: ${hint}`);
  }

  // Create responses put the URN in `x-restli-id`, not the JSON body (see Posts API docs).
  const fromHeader = resp.headers.get('x-restli-id')?.trim();
  const postId =
    (fromHeader && String(fromHeader)) || (json.id != null ? String(json.id) : null);
  return { platform: 'linkedin', postId, success: true };
}

module.exports = { postLinkedin, toPersonUrn, linkedinApiVersion };
