/**
 * X (Twitter) OAuth 2.0 (Authorization Code with PKCE) configuration.
 * OAuth 2.0 client id/secret in the X portal use the same values as API Key / API Key Secret
 * (consumer key / consumer secret).
 * @param {import('express').Request} req
 */
function resolveTwitterOAuthRedirectUri(req) {
  const explicit = String(process.env.TWITTER_OAUTH_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;
  const pub = String(process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (pub) {
    return `${pub}/auth/twitter/callback`;
  }
  const forceHttps =
    process.env.FORCE_HTTPS === "1" ||
    process.env.FORCE_HTTPS === "true" ||
    String(process.env.USE_HTTPS_PUBLIC_URL ?? "").toLowerCase() === "true";
  const proto = forceHttps ? "https" : req.protocol;
  const host = req.get("host") || "";
  return `${proto}://${host}/auth/twitter/callback`;
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
  const clientId = String(
    process.env.TWITTER_CONSUMER_KEY ?? process.env.TWITTER_CLIENT_ID ?? "",
  ).trim();
  const clientSecret = String(
    process.env.TWITTER_CONSUMER_SECRET ?? process.env.TWITTER_CLIENT_SECRET ?? "",
  ).trim();
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
