const {
  TWITTER_TOKEN_URL,
  getTwitterClientCredentials,
} = require("./config");

/**
 * @param {string} clientId
 * @param {string} clientSecret
 */
function basicAuthHeader(clientId, clientSecret) {
  const b = Buffer.from(`${clientId}:${clientSecret}`, "utf8");
  return `Basic ${b.toString("base64")}`;
}

/**
 * @param {object} params
 * @param {string} params.code
 * @param {string} params.redirectUri
 * @param {string} params.codeVerifier
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
async function exchangeAuthorizationCode({ code, redirectUri, codeVerifier }) {
  const { clientId, clientSecret } = getTwitterClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Twitter OAuth: TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: String(redirectUri),
    code_verifier: String(codeVerifier),
    client_id: clientId,
  });

  const resp = await fetch(TWITTER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: body.toString(),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) {
    const msg =
      json.error_description ||
      json.error ||
      json.errors?.[0]?.message ||
      resp.statusText ||
      "token exchange failed";
    throw new Error(`Twitter OAuth token: ${msg}`);
  }
  if (!json.access_token) {
    throw new Error("Twitter OAuth token: missing access_token");
  }
  return json;
}

/**
 * @param {object} params
 * @param {string} params.refreshToken
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
async function refreshAccessToken({ refreshToken }) {
  const { clientId, clientSecret } = getTwitterClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Twitter OAuth: TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: String(refreshToken),
    client_id: clientId,
  });

  const resp = await fetch(TWITTER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: body.toString(),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) {
    const msg =
      json.error_description ||
      json.error ||
      json.errors?.[0]?.message ||
      resp.statusText ||
      "refresh failed";
    throw new Error(`Twitter OAuth refresh: ${msg}`);
  }
  if (!json.access_token) {
    throw new Error("Twitter OAuth refresh: missing access_token");
  }
  return json;
}

module.exports = {
  exchangeAuthorizationCode,
  refreshAccessToken,
};
