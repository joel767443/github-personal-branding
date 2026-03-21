const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { readCurrentEnv } = require('../config/runtimeConfig');

function mergedEnv() {
  return { ...process.env, ...readCurrentEnv() };
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

  return {
    clientId: String(envSnapshot.GITHUB_CLIENT_ID ?? '').trim(),
    clientSecret: String(envSnapshot.GITHUB_CLIENT_SECRET ?? '').trim(),
    callbackUrl:
      (envSnapshot.GITHUB_OAUTH_CALLBACK_URL && String(envSnapshot.GITHUB_OAUTH_CALLBACK_URL).trim()) ||
      defaultCallback,
  };
}

/**
 * @param {import('express').Request} req
 */
async function isGithubOAuthConfigured(req) {
  const envSnapshot = mergedEnv();
  if (envSnapshot.GITHUB_CLIENT_ID && envSnapshot.GITHUB_CLIENT_SECRET) return true;
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
};
