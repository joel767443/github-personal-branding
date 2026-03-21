const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');
const { createGithubClient } = require('./githubService');

/**
 * Resolve GitHub API token and username for a developer (encrypted fields on `developers` only).
 * Do not use global GITHUB_TOKEN / GITHUB_USERNAME — multi-tenant installs store credentials per row.
 * @param {number} developerId
 * @returns {Promise<{ token: string, username: string | null } | null>}
 */
async function getGithubCredentialsForDeveloper(developerId) {
  if (developerId == null || Number.isNaN(Number(developerId))) {
    return null;
  }
  const dev = await prisma.developer.findUnique({
    where: { id: developerId },
    select: {
      githubAccessTokenEnc: true,
      githubUsername: true,
      githubLogin: true,
      email: true,
    },
  });
  if (!dev) return null;

  if (!dev.githubAccessTokenEnc) {
    return null;
  }
  try {
    const token = decryptField(dev.githubAccessTokenEnc);
    if (!token) return null;
    const username =
      (dev.githubUsername && String(dev.githubUsername).trim()) ||
      (dev.githubLogin && String(dev.githubLogin).trim()) ||
      null;
    return { token, username };
  } catch {
    return null;
  }
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

/**
 * @param {number} developerId
 * @param {string} accessToken
 * @param {string | null | undefined} [refreshToken]
 */
async function saveGithubTokensForDeveloper(developerId, accessToken, refreshToken = null) {
  const { encryptField } = require('../crypto/fieldEncryption');
  const data = {
    githubAccessTokenEnc: encryptField(accessToken),
  };
  if (refreshToken) {
    data.githubRefreshTokenEnc = encryptField(refreshToken);
  }
  await prisma.developer.update({
    where: { id: developerId },
    data,
  });
}

module.exports = {
  getGithubCredentialsForDeveloper,
  getGithubClientForDeveloper,
  saveGithubTokensForDeveloper,
};
