const axios = require('axios');

const BASE_URL = "https://api.github.com";

const github = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
});

function hasGithubToken() {
  return Boolean(String(process.env.GITHUB_TOKEN ?? "").trim());
}

async function getPublicReposForUser(login) {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const res = await github.get(`/users/${encodeURIComponent(login)}/repos`, {
      params: {
        per_page: perPage,
        page,
        sort: "updated",
        direction: "desc",
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
 * Lists repositories for sync.
 * - With `GITHUB_TOKEN`: uses `GET /user/repos` so private repos are included (requires `repo` scope on classic PATs).
 *   When `username` is set, results are limited to repos whose `owner.login` matches (same intent as `/users/{username}/repos`, but not public-only).
 * - Without token: falls back to public-only `/users/{username}/repos` when username is set.
 */
async function getRepos(username) {
  if (hasGithubToken()) {
    const all = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const res = await github.get("/user/repos", {
        params: {
          visibility: "all",
          affiliation: "owner,collaborator,organization_member",
          per_page: perPage,
          page,
          sort: "updated",
          direction: "desc",
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
    return getPublicReposForUser(String(username));
  }

  const res = await github.get("/user/repos");
  return Array.isArray(res.data) ? res.data : [];
}

async function getCommits(owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/commits`);
  return res.data;
}

async function getRepoLanguages(owner, repo) {
  // GitHub returns an object like: { "JavaScript": 12345, "TypeScript": 678 }
  const res = await github.get(`/repos/${owner}/${repo}/languages`);
  return res.data;
}

async function getUserProfile(username) {
  const res = await github.get(`/users/${username}`);
  return res.data;
}

async function getRepoContents(owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/contents`);
  return res.data;
}

async function getRepoTopics(owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/topics`);
  // GitHub returns: { names: [...] }
  return res.data?.names ?? [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRepoGitTreeFiles(owner, repo, branch = "main") {
  // Example endpoint:
  // GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
  const url = `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;

  try {
    const res = await github.get(url, { timeout: 30_000 });
    const tree = res.data?.tree ?? [];
    return tree.filter((item) => item.type === "blob").map((item) => String(item.path).toLowerCase());
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403) {
      // Same spirit as your Python script: rate-limit hit → wait and retry.
      await sleep(70_000);
      const res = await github.get(url, { timeout: 30_000 });
      const tree = res.data?.tree ?? [];
      return tree.filter((item) => item.type === "blob").map((item) => String(item.path).toLowerCase());
    }
    throw err;
  }
}

module.exports = {
  getRepos,
  getCommits,
  getRepoLanguages,
  getUserProfile,
  getRepoContents,
  getRepoTopics,
  getRepoGitTreeFiles
};