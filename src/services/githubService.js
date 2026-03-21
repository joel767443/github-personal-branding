const axios = require('axios');

const BASE_URL = 'https://api.github.com';

const DEFAULT_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * @param {string} token
 */
function createGithubClient(token) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      ...DEFAULT_HEADERS,
      Authorization: `Bearer ${token}`,
    },
  });
}

/** Unauthenticated or env-token client; prefer `createGithubClient` with a token from `getGithubCredentialsForDeveloper`. */
function getEnvGithubClient() {
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  if (!token) {
    return axios.create({
      baseURL: BASE_URL,
      headers: { ...DEFAULT_HEADERS },
    });
  }
  return createGithubClient(token);
}

function hasGithubToken() {
  return Boolean(String(process.env.GITHUB_TOKEN ?? '').trim());
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getPublicReposForUser(github, login) {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const res = await github.get(`/users/${encodeURIComponent(login)}/repos`, {
      params: {
        per_page: perPage,
        page,
        sort: 'updated',
        direction: 'desc',
      },
    });
    const batch = Array.isArray(res.data) ? res.data : [];
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return all;
}

/**
 * @param {import('axios').AxiosInstance} github
 * @param {string | null | undefined} username
 */
async function getRepos(github, username) {
  const tokenPresent = Boolean(github?.defaults?.headers?.Authorization);
  if (tokenPresent) {
    const all = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const res = await github.get('/user/repos', {
        params: {
          visibility: 'all',
          affiliation: 'owner,collaborator,organization_member',
          per_page: perPage,
          page,
          sort: 'updated',
          direction: 'desc',
        },
      });
      const batch = Array.isArray(res.data) ? res.data : [];
      all.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }

    if (username) {
      const want = String(username).toLowerCase();
      return all.filter((r) => r?.owner?.login && String(r.owner.login).toLowerCase() === want);
    }
    return all;
  }

  if (username) {
    return getPublicReposForUser(github, String(username));
  }

  const res = await github.get('/user/repos');
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getCommits(github, owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/commits`);
  return res.data;
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getRepoLanguages(github, owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/languages`);
  return res.data;
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getUserProfile(github, username) {
  const res = await github.get(`/users/${username}`);
  return res.data;
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getRepoContents(github, owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/contents`);
  return res.data;
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getRepoTopics(github, owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/topics`);
  return res.data?.names ?? [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getRepoGitTreeFiles(github, owner, repo, branch = 'main') {
  const url = `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;

  try {
    const res = await github.get(url, { timeout: 30_000 });
    const tree = res.data?.tree ?? [];
    return tree.filter((item) => item.type === 'blob').map((item) => String(item.path).toLowerCase());
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403) {
      await sleep(70_000);
      const res = await github.get(url, { timeout: 30_000 });
      const tree = res.data?.tree ?? [];
      return tree.filter((item) => item.type === 'blob').map((item) => String(item.path).toLowerCase());
    }
    throw err;
  }
}

module.exports = {
  createGithubClient,
  getEnvGithubClient,
  hasGithubToken,
  getRepos,
  getCommits,
  getRepoLanguages,
  getUserProfile,
  getRepoContents,
  getRepoTopics,
  getRepoGitTreeFiles,
};
