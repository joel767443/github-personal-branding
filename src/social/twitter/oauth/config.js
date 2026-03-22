/**
 * X (Twitter) OAuth 2.0 (Authorization Code with PKCE) configuration.
 * @param {import('express').Request} req
 */
function resolveTwitterOAuthRedirectUri(req) {
  const explicit = String(process.env.TWITTER_OAUTH_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;
  return `${req.protocol}://${req.get("host")}/auth/twitter/callback`;
}

const TWITTER_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const TWITTER_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";

/** Default scopes for user-context tweet posting + refresh token. */
function resolveTwitterOAuthScopes() {
  const raw = String(process.env.TWITTER_OAUTH_SCOPES ?? "").trim();
  if (raw) {
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
  }
  return "tweet.read tweet.write users.read offline.access";
}

function getTwitterClientCredentials() {
  const clientId = String(process.env.TWITTER_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.TWITTER_CLIENT_SECRET ?? "").trim();
  return { clientId, clientSecret };
}

function isTwitterOAuthConfigured() {
  const { clientId, clientSecret } = getTwitterClientCredentials();
  return Boolean(clientId && clientSecret);
}

module.exports = {
  resolveTwitterOAuthRedirectUri,
  resolveTwitterOAuthScopes,
  TWITTER_AUTHORIZE_URL,
  TWITTER_TOKEN_URL,
  getTwitterClientCredentials,
  isTwitterOAuthConfigured,
};
