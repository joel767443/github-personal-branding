const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { readCurrentEnv } = require('../config/runtimeConfig');

function mergedEnv() {
  return { ...process.env, ...readCurrentEnv() };
}

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
async function findDeveloperOAuthCredentialsByEnvClientId(envClientId, defaultCallback) {
  if (!envClientId) return null;
  const dev = await prisma.developer.findFirst({
    where: {
      githubOauthClientId: envClientId,
      githubOauthClientSecretEnc: { not: null },
    },
    select: {
      githubOauthClientId: true,
      githubOauthClientSecretEnc: true,
      githubOauthCallbackUrl: true,
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
  const cb =
    (dev.githubOauthCallbackUrl && String(dev.githubOauthCallbackUrl).trim()) || defaultCallback;
  return {
    clientId: String(dev.githubOauthClientId).trim(),
    clientSecret,
    callbackUrl: cb,
  };
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
  const defaultCallback = `${req.protocol}://${req.get('host')}/auth/github/callback`;
  const envCallback =
    (envSnapshot.GITHUB_OAUTH_CALLBACK_URL && String(envSnapshot.GITHUB_OAUTH_CALLBACK_URL).trim()) ||
    defaultCallback;

  const devId = req.session?.oauthDeveloperId ?? req.session?.user?.developerId ?? null;
  if (devId != null && !Number.isNaN(Number(devId))) {
    const dev = await prisma.developer.findUnique({
      where: { id: Number(devId) },
      select: {
        githubOauthClientId: true,
        githubOauthClientSecretEnc: true,
        githubOauthCallbackUrl: true,
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
        const cb =
          (dev.githubOauthCallbackUrl && String(dev.githubOauthCallbackUrl).trim()) || defaultCallback;
        return {
          clientId: String(dev.githubOauthClientId).trim(),
          clientSecret,
          callbackUrl: cb,
        };
      }
    }
  }

  const envClientId = String(envSnapshot.GITHUB_CLIENT_ID ?? '').trim();
  const envClientSecret = resolveGithubOAuthClientSecretFromEnv(envSnapshot);
  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      callbackUrl: envCallback,
    };
  }

  if (envClientId && !envClientSecret) {
    const fromDb = await findDeveloperOAuthCredentialsByEnvClientId(envClientId, defaultCallback);
    if (fromDb) return fromDb;
  }

  return {
    clientId: envClientId,
    clientSecret: envClientSecret,
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
  isGithubOAuthConfigured,
  mergedEnv,
  resolveGithubOAuthClientSecretFromEnv,
};
