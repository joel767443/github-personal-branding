const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { mergedEnv } = require('../config/runtimeConfig');

/**
 * Personal access tokens (PATs) must never be sent as OAuth `client_secret` — GitHub returns
 * `incorrect_client_credentials`. OAuth login requires the OAuth App's **Client secrets** from
 * GitHub → Settings → Developer settings → OAuth Apps (or `GITHUB_CLIENT_SECRET` in `.env`).
 */
function isLikelyGithubPersonalAccessToken(value) {
  const t = String(value ?? '').trim();
  if (!t) return false;
  return /^(ghp_|github_pat_|gho_|ghu_|ghs_)/i.test(t);
}

/**
 * OAuth token exchange uses `GITHUB_CLIENT_SECRET` only.
 * Optional legacy: if `GITHUB_TOKEN` is set and does **not** look like a PAT, treat it as a misnamed
 * client secret (some teams store the OAuth app secret under that name).
 */
function resolveGithubOAuthClientSecretFromEnv(envSnapshot) {
  const fromSecret = String(envSnapshot.GITHUB_CLIENT_SECRET ?? '').trim();
  if (fromSecret) return fromSecret;
  const fromToken = String(envSnapshot.GITHUB_TOKEN ?? '').trim();
  if (fromToken && !isLikelyGithubPersonalAccessToken(fromToken)) return fromToken;
  return '';
}

/**
 * When `.env` has `GITHUB_CLIENT_ID` but no OAuth client secret (e.g. only a PAT in `GITHUB_TOKEN`),
 * use a developer row that already stores the same OAuth App id + encrypted client secret (e.g. from settings).
 */
async function findDeveloperOAuthCredentialsByEnvClientId(envClientId, callbackUrl) {
  if (!envClientId) return null;
  const dev = await prisma.developer.findFirst({
    where: {
      githubOauthClientId: envClientId,
      githubOauthClientSecretEnc: { not: null },
    },
    select: {
      githubOauthClientId: true,
      githubOauthClientSecretEnc: true,
    },
  });
  if (!dev?.githubOauthClientId || !dev.githubOauthClientSecretEnc) return null;
  let clientSecret;
  try {
    clientSecret = decryptField(dev.githubOauthClientSecretEnc);
  } catch {
    clientSecret = null;
  }
  if (!clientSecret) return null;
  return {
    clientId: String(dev.githubOauthClientId).trim(),
    clientSecret: String(clientSecret).trim(),
    callbackUrl,
  };
}

/**
 * GitHub compares redirect_uri to the OAuth App’s “Authorization callback URL” (exact match).
 * @param {string} u
 * @returns {string}
 */
function normalizeGithubRedirectUri(u) {
  const s = String(u ?? '').trim();
  if (!s) return s;
  try {
    const parsed = new URL(s);
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return s.replace(/\/+$/, '') || s;
  }
}

/**
 * Public browser scheme for OAuth callback when built from the request (behind Caddy/nginx, use forwarded proto).
 * @param {import('express').Request} req
 * @returns {'http' | 'https'}
 */
function resolvePublicProtoForOAuth(req) {
  const forceHttps =
    process.env.FORCE_HTTPS === '1' ||
    process.env.FORCE_HTTPS === 'true' ||
    String(process.env.USE_HTTPS_PUBLIC_URL ?? '').toLowerCase() === 'true';
  if (forceHttps) return 'https';
  const fp = String(req.get('x-forwarded-proto') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (fp === 'https' || fp === 'http') return fp;
  return req.protocol === 'https' ? 'https' : 'http';
}

/**
 * Same precedence as Twitter/X: explicit env → PUBLIC_BASE_URL + path → request host.
 * Prefer https when behind TLS termination (X-Forwarded-Proto) or FORCE_HTTPS.
 * @param {import('express').Request} req
 */
function resolveGithubOAuthCallbackUrl(req) {
  const envSnapshot = mergedEnv();
  const explicit = String(envSnapshot.GITHUB_OAUTH_CALLBACK_URL ?? '').trim();
  if (explicit) {
    return normalizeGithubRedirectUri(explicit);
  }
  const pub = String(envSnapshot.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (pub) {
    return normalizeGithubRedirectUri(`${pub}/auth/github/callback`);
  }
  const proto = resolvePublicProtoForOAuth(req);
  const host = req.get('host') || '';
  return normalizeGithubRedirectUri(`${proto}://${host}/auth/github/callback`);
}

/**
 * GitHub OAuth authorize + token exchange: server env app, or optional BYO app on `developers`
 * (when `req.session.oauthDeveloperId` / `req.session.user.developerId` is set).
 *
 * @param {import('express').Request} req
 * @returns {Promise<{ clientId: string, clientSecret: string, callbackUrl: string } | { clientId: '', clientSecret: '', callbackUrl: string }>}
 */
async function resolveGithubOAuthAppCredentials(req) {
  const envSnapshot = mergedEnv();
  const envCallback = resolveGithubOAuthCallbackUrl(req);

  const envClientId = String(envSnapshot.GITHUB_CLIENT_ID ?? '').trim();
  const envClientSecret = resolveGithubOAuthClientSecretFromEnv(envSnapshot);

  // Server `.env` OAuth app (`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`) takes precedence over
  // per-developer BYO rows so local/staging config is never ignored when a user is logged in.
  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: String(envClientSecret).trim(),
      callbackUrl: envCallback,
    };
  }

  const devId = req.session?.oauthDeveloperId ?? req.session?.user?.developerId ?? null;
  if (devId != null && !Number.isNaN(Number(devId))) {
    const dev = await prisma.developer.findUnique({
      where: { id: Number(devId) },
      select: {
        githubOauthClientId: true,
        githubOauthClientSecretEnc: true,
      },
    });
    if (dev?.githubOauthClientId && dev.githubOauthClientSecretEnc) {
      let clientSecret;
      try {
        clientSecret = decryptField(dev.githubOauthClientSecretEnc);
      } catch {
        clientSecret = null;
      }
      if (clientSecret) {
        return {
          clientId: String(dev.githubOauthClientId).trim(),
          clientSecret: String(clientSecret).trim(),
          callbackUrl: envCallback,
        };
      }
    }
  }

  if (envClientId && !envClientSecret) {
    const fromDb = await findDeveloperOAuthCredentialsByEnvClientId(envClientId, envCallback);
    if (fromDb) return fromDb;
  }

  return {
    clientId: envClientId,
    clientSecret: String(envClientSecret).trim(),
    callbackUrl: envCallback,
  };
}

/**
 * @param {import('express').Request} req
 */
async function isGithubOAuthConfigured(req) {
  const envSnapshot = mergedEnv();
  const envClientId = String(envSnapshot.GITHUB_CLIENT_ID ?? '').trim();
  const clientSecret = resolveGithubOAuthClientSecretFromEnv(envSnapshot);
  if (envClientId && clientSecret) return true;
  if (envClientId && !clientSecret) {
    const row = await prisma.developer.findFirst({
      where: { githubOauthClientId: envClientId, githubOauthClientSecretEnc: { not: null } },
      select: { id: true },
    });
    if (row) return true;
  }
  if (!req.session?.user?.developerId) return false;
  const dev = await prisma.developer.findUnique({
    where: { id: req.session.user.developerId },
    select: { githubOauthClientId: true, githubOauthClientSecretEnc: true },
  });
  return Boolean(dev?.githubOauthClientId && dev.githubOauthClientSecretEnc);
}

module.exports = {
  resolveGithubOAuthAppCredentials,
  resolveGithubOAuthCallbackUrl,
  resolvePublicProtoForOAuth,
  normalizeGithubRedirectUri,
  isGithubOAuthConfigured,
  resolveGithubOAuthClientSecretFromEnv,
};
