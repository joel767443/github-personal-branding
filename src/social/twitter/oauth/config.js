function normalizeTwitterRedirectUri(u) {
  const s = String(u ?? "").trim();
  if (!s) return s;
  try {
    const parsed = new URL(s);
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return s.replace(/\/+$/, "") || s;
  }
}

function resolvePublicProtoForOAuth(req) {
  const forceHttps =
    process.env.FORCE_HTTPS === "1" ||
    process.env.FORCE_HTTPS === "true" ||
    String(process.env.USE_HTTPS_PUBLIC_URL ?? "").toLowerCase() === "true";
  if (forceHttps) return "https";
  const fp = String(req.get("x-forwarded-proto") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (fp === "https" || fp === "http") return fp;
  return req.protocol === "https" ? "https" : "http";
}

/**
 * X (Twitter) OAuth 2.0 (Authorization Code with PKCE) configuration.
 * OAuth 2.0 client id/secret in the X portal use the same values as API Key / API Key Secret
 * (consumer key / consumer secret).
 * @param {import('express').Request} req
 */
function resolveTwitterOAuthRedirectUri(req) {
  const explicit = String(process.env.TWITTER_OAUTH_CALLBACK_URL ?? "").trim();
  if (explicit) return normalizeTwitterRedirectUri(explicit);
  const pub = String(process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (pub) {
    return normalizeTwitterRedirectUri(`${pub}/auth/twitter/callback`);
  }
  const proto = resolvePublicProtoForOAuth(req);
  const host = req.get("host") || "";
  return normalizeTwitterRedirectUri(`${proto}://${host}/auth/twitter/callback`);
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
  normalizeTwitterRedirectUri,
  resolveTwitterOAuthScopes,
  TWITTER_AUTHORIZE_URL,
  TWITTER_TOKEN_URL,
  getTwitterClientCredentials,
  isTwitterOAuthConfigured,
};
