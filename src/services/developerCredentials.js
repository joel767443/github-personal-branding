const prisma = require('../db/prisma');
const { createGithubClient } = require('./githubService');
const { readCurrentEnv } = require('../config/runtimeConfig');

function mergedEnv() {
  return { ...process.env, ...readCurrentEnv() };
}

/**
 * GitHub API access uses `GITHUB_TOKEN` from the server environment (`.env` / process env).
 * The developer row supplies `githubUsername` / `githubLogin` for which GitHub user to sync.
 * @param {number} developerId
 * @returns {Promise<{ token: string, username: string | null } | null>}
 */
async function getGithubCredentialsForDeveloper(developerId) {
  if (developerId == null || Number.isNaN(Number(developerId))) {
    return null;
  }
  const token = String(mergedEnv().GITHUB_TOKEN ?? '').trim();
  if (!token) return null;

  const dev = await prisma.developer.findUnique({
    where: { id: Number(developerId) },
    select: {
      githubUsername: true,
      githubLogin: true,
      email: true,
    },
  });
  if (!dev) return null;

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
