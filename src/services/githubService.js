const axios = require('axios');

const BASE_URL = 'https://api.github.com';

const DEFAULT_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attaches rate limiting interceptors to an axios instance.
 * @param {import('axios').AxiosInstance} instance
 */
function attachRateLimiter(instance) {
  instance.interceptors.request.use(async (config) => {
    // Basic jitter/throttle to prevent absolute bursts
    await sleep(50);
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const { config, response } = error;
      if (response && response.status === 403 && response.headers['x-ratelimit-remaining'] === '0') {
        const resetTime = parseInt(response.headers['x-ratelimit-reset'], 10) * 1000;
        const waitTime = resetTime - Date.now() + 1000;
        if (waitTime > 0) {
          console.warn(`GitHub Rate Limit Exceeded. Waiting for ${waitTime / 1000}s...`);
          await sleep(waitTime);
          return instance(config);
        }
      }
      return Promise.reject(error);
    }
  );
}

/**
 * @param {string} token
 */
function createGithubClient(token) {
  const instance = axios.create({
    baseURL: BASE_URL,
    headers: {
      ...DEFAULT_HEADERS,
      Authorization: `Bearer ${token}`,
    },
  });
  attachRateLimiter(instance);
  return instance;
}

/** Unauthenticated or env-token client; prefer `createGithubClient` with a token from `getGithubCredentialsForDeveloper`. */
function getEnvGithubClient() {
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  const instance = axios.create({
    baseURL: BASE_URL,
    headers: token ? { ...DEFAULT_HEADERS, Authorization: `Bearer ${token}` } : { ...DEFAULT_HEADERS },
  });
  attachRateLimiter(instance);
  return instance;
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

/**
 * @param {import('axios').AxiosInstance} github
 */
async function getRepository(github, owner, repo) {
  const res = await github.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  return res.data;
}

/**
 * README body as plain text (Markdown). Returns null if missing or inaccessible.
 *
 * @param {import('axios').AxiosInstance} github
 */
async function getRepoReadmePlaintext(github, owner, repo) {
  try {
    const res = await github.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, {
      headers: { Accept: 'application/vnd.github.raw' },
      responseType: 'text',
      transformResponse: [(data) => data],
    });
    const t = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    return t.trim() || null;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

/** @param {Date} d */
function formatGithubSearchDayUtc(d) {
  const x = new Date(d.getTime());
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pull requests where the user is the author and `updated` falls in [start, end] (UTC dates in query).
 *
 * @param {import('axios').AxiosInstance} github
 * @param {string} login GitHub login
 * @param {Date} start
 * @param {Date} end
 * @param {{ maxResults?: number }} [opts]
 * @returns {Promise<Array<{ title: string, html_url: string, state: string, repository_url?: string }>>}
 */
async function searchUserPullRequestsInRange(github, login, start, end, opts = {}) {
  const maxResults = Math.min(Number(opts.maxResults ?? 80) || 80, 1000);
  const a = formatGithubSearchDayUtc(start);
  const b = formatGithubSearchDayUtc(end);
  const q = `is:pr author:${login} updated:${a}..${b}`;
  const out = [];
  let page = 1;
  const perPage = 100;
  while (out.length < maxResults) {
    const res = await github.get('/search/issues', {
      params: {
        q,
        per_page: perPage,
        page,
        sort: 'updated',
        order: 'desc',
      },
    });
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    for (const it of items) {
      out.push({
        title: String(it?.title ?? ''),
        html_url: String(it?.html_url ?? ''),
        state: String(it?.state ?? ''),
        repository_url: it?.repository_url != null ? String(it.repository_url) : undefined,
      });
      if (out.length >= maxResults) break;
    }
    if (items.length < perPage) break;
    page += 1;
    if (page > 10) break;
  }
  return out;
}

/**
 * Loads blob paths from the git tree. Tries `preferredBranch`, then main/master, then GitHub `default_branch`.
 *
 * @param {import('axios').AxiosInstance} github
 * @param {string} [preferredBranch] job option (default `main`)
 */
async function getRepoGitTreeFilesWithBranchFallback(github, owner, repo, preferredBranch = 'main') {
  const seen = new Set();
  /** @type {string[]} */
  const branchOrder = [];
  const push = (b) => {
    if (b == null || String(b).trim() === '') return;
    const s = String(b).trim();
    if (seen.has(s)) return;
    seen.add(s);
    branchOrder.push(s);
  };

  push(preferredBranch);
  push('main');
  push('master');

  const tryBranch = async (b) => {
    try {
      return await getRepoGitTreeFiles(github, owner, repo, b);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return null;
      throw err;
    }
  };

  for (const b of branchOrder) {
    const files = await tryBranch(b);
    if (files !== null) return files;
  }

  try {
    const meta = await getRepository(github, owner, repo);
    const def = meta?.default_branch;
    if (def && !seen.has(String(def))) {
      const files = await tryBranch(String(def));
      if (files !== null) return files;
    }
  } catch {
    // ignore
  }

  return [];
}

module.exports = {
  createGithubClient,
  getEnvGithubClient,
  getRepos,
  getCommits,
  getRepoLanguages,
  getUserProfile,
  getRepoContents,
  getRepoTopics,
  getRepoGitTreeFiles,
  getRepository,
  getRepoReadmePlaintext,
  searchUserPullRequestsInRange,
  getRepoGitTreeFilesWithBranchFallback,
};
