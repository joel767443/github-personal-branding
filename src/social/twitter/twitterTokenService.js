const { decryptField } = require("../../crypto/fieldEncryption");
const { refreshAccessToken } = require("./oauth/tokenClient");
const {
  findTwitterAuthByDeveloperId,
  upsertTwitterAuth,
} = require("./twitterAuthRepository");

/** Skew: refresh slightly before wall-clock expiry. */
const EXPIRY_SKEW_MS = 90_000;

/**
 * Valid decrypted access token for API calls; refreshes using refresh_token when needed.
 * @param {number} developerId
 * @returns {Promise<string>}
 */
async function getDecryptedAccessTokenForDeveloper(developerId) {
  const row = await findTwitterAuthByDeveloperId(developerId);
  if (!row?.accessTokenEnc) {
    throw new Error("Twitter: no OAuth tokens saved for this developer");
  }

  let accessPlain;
  try {
    accessPlain = decryptField(row.accessTokenEnc);
  } catch (e) {
    throw new Error(`Twitter: could not decrypt access token (${e?.message ?? e})`);
  }
  if (!accessPlain) {
    throw new Error("Twitter: empty access token after decrypt");
  }

  const expiresAt = row.accessTokenExpiresAt ? new Date(row.accessTokenExpiresAt).getTime() : null;
  const now = Date.now();
  const needsRefresh =
    expiresAt != null && expiresAt - EXPIRY_SKEW_MS <= now && row.refreshTokenEnc;

  if (!needsRefresh) {
    if (expiresAt != null && expiresAt - EXPIRY_SKEW_MS <= now && !row.refreshTokenEnc) {
      throw new Error(
        "Twitter: access token expired and no refresh token stored; reconnect X in settings.",
      );
    }
    return accessPlain;
  }

  let refreshPlain;
  try {
    refreshPlain = decryptField(row.refreshTokenEnc);
  } catch (e) {
    throw new Error(`Twitter: could not decrypt refresh token (${e?.message ?? e})`);
  }
  if (!refreshPlain) {
    throw new Error("Twitter: reconnect X in settings (refresh token missing).");
  }

  const tokenJson = await refreshAccessToken({ refreshToken: refreshPlain });
  const expiresIn = Number(tokenJson.expires_in);
  const accessTokenExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now + expiresIn * 1000) : null;

  const newRefresh =
    tokenJson.refresh_token != null && String(tokenJson.refresh_token).trim()
      ? String(tokenJson.refresh_token)
      : refreshPlain;

  await upsertTwitterAuth(developerId, {
    twitterUserId: row.twitterUserId,
    twitterUsername: row.twitterUsername,
    accessTokenPlain: tokenJson.access_token,
    refreshTokenPlain: newRefresh,
    accessTokenExpiresAt,
  });

  return String(tokenJson.access_token);
}

module.exports = {
  getDecryptedAccessTokenForDeveloper,
  EXPIRY_SKEW_MS,
};
