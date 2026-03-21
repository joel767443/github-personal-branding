const prisma = require('../db/prisma');
const { decryptField } = require('../crypto/fieldEncryption');

/**
 * @returns {{ token: string, username: string | null } | null}
 */
function githubFromEnv() {
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  if (!token) return null;
  const username = String(process.env.GITHUB_USERNAME ?? '').trim() || null;
  return { token, username };
}

/**
 * Resolve GitHub API token and username for sync jobs.
 * Prefers per-developer encrypted token; falls back to global env (single-tenant / dev).
 * @param {number} developerId
 * @returns {Promise<{ token: string, username: string | null } | null>}
 */
async function getGithubCredentialsForDeveloper(developerId) {
  if (developerId == null || Number.isNaN(Number(developerId))) {
    return githubFromEnv();
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

  if (dev.githubAccessTokenEnc) {
    try {
      const token = decryptField(dev.githubAccessTokenEnc);
      if (!token) return githubFromEnv();
      const username =
        (dev.githubUsername && String(dev.githubUsername).trim()) ||
        (dev.githubLogin && String(dev.githubLogin).trim()) ||
        null;
      return { token, username };
    } catch {
      return githubFromEnv();
    }
  }

  return githubFromEnv();
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
  githubFromEnv,
  saveGithubTokensForDeveloper,
};
