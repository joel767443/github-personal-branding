const prisma = require('../db/prisma');
const { createGithubClient } = require('./githubService');
const { mergedEnv } = require('../config/runtimeConfig');
const { decryptField } = require('../crypto/fieldEncryption');

/**
 * GitHub API access: prefers encrypted `githubPatEnc` on the developer row, then `GITHUB_TOKEN` in env.
 * The developer row supplies `githubUsername` / `githubLogin` for which GitHub user to sync.
 * @param {number} developerId
 * @returns {Promise<{ token: string, username: string | null } | null>}
 */
async function getGithubCredentialsForDeveloper(developerId) {
  if (developerId == null || Number.isNaN(Number(developerId))) {
    return null;
  }

  const dev = await prisma.developer.findUnique({
    where: { id: Number(developerId) },
    select: {
      githubUsername: true,
      githubLogin: true,
      email: true,
      githubPatEnc: true,
    },
  });
  if (!dev) return null;

  let token = '';
  if (dev.githubPatEnc) {
    try {
      token = String(decryptField(dev.githubPatEnc) ?? '').trim();
    } catch (err) {
      console.warn('getGithubCredentialsForDeveloper: decrypt githubPatEnc failed', err?.message ?? err);
    }
  }
  if (!token) {
    token = String(mergedEnv().GITHUB_TOKEN ?? '').trim();
  }
  if (!token) return null;

  const username =
    (dev.githubUsername && String(dev.githubUsername).trim()) ||
    (dev.githubLogin && String(dev.githubLogin).trim()) ||
    null;
  return { token, username };
}

/**
 * @param {number | null | undefined} developerId
 * @returns {Promise<import('axios').AxiosInstance | null>}
 */
async function getGithubClientForDeveloper(developerId) {
  const creds = await getGithubCredentialsForDeveloper(developerId);
  if (!creds?.token) return null;
  return createGithubClient(creds.token);
}

module.exports = {
  getGithubCredentialsForDeveloper,
  getGithubClientForDeveloper,
};
