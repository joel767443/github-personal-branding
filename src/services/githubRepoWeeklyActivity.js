/**
 * Fetch recent GitHub activity for a single repository (commits + PRs) for Gemini sample posts.
 *
 * Env:
 *   GITHUB_ACTIVITY_REPO — optional `owner/repo` override (otherwise uses `git remote get-url origin` from cwd)
 *   POST_ACTIVITY_DAYS — optional, default 7 (rolling window ending `now`)
 */

const path = require("path");
const { execSync } = require("child_process");
const { createGithubClient, getEnvGithubClient } = require("./githubService");

/**
 * @param {string} raw
 * @returns {{ owner: string, repo: string } | null}
 */
function parseGithubRemoteUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const mSsh = /^git@github\.com:([^/]+)\/([^.\s]+)(\.git)?$/i.exec(s);
  if (mSsh) return { owner: mSsh[1], repo: mSsh[2] };
  try {
    const u = new URL(s);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

/**
 * @param {string} [cwd] repo root (directory containing `.git`)
 * @returns {{ owner: string, repo: string }}
 */
function resolveGithubActivityRepo(cwd) {
  const env = String(process.env.GITHUB_ACTIVITY_REPO ?? "").trim();
  if (env) {
    const parts = env.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2 && !parts[0].includes(" ") && !parts[1].includes(" ")) {
      return { owner: parts[0], repo: parts[1] };
    }
    throw new Error(
      `Invalid GITHUB_ACTIVITY_REPO="${env}". Use owner/repo (e.g. acme/github-intel-service).`,
    );
  }
  const root = cwd ?? path.join(__dirname, "..", "..");
  let url;
  try {
    url = execSync("git remote get-url origin", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      `Could not read git origin. Set GITHUB_ACTIVITY_REPO=owner/repo or run from a clone with github.com origin (cwd=${root}).`,
    );
  }
  const parsed = parseGithubRemoteUrl(url);
  if (!parsed) {
    throw new Error(`Origin URL is not a github.com repo: ${url.slice(0, 120)}`);
  }
  return parsed;
}

/**
 * @param {import('axios').AxiosInstance} github
 * @param {string} owner
 * @param {string} repo
 * @param {string} sinceIso
 */
async function listCommitsSince(github, owner, repo, sinceIso) {
  const out = [];
  let page = 1;
  while (page <= 30) {
    const res = await github.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`, {
      params: { since: sinceIso, per_page: 100, page },
    });
    const batch = Array.isArray(res.data) ? res.data : [];
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out;
}

/**
 * @param {import('axios').AxiosInstance} github
 * @param {string} owner
 * @param {string} repo
 * @param {Date} start
 * @param {Date} end
 */
async function listPullsUpdatedInRange(github, owner, repo, start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const out = [];
  let page = 1;
  while (page <= 30) {
    const res = await github.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      params: {
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
      },
    });
    const batch = Array.isArray(res.data) ? res.data : [];
    let stop = false;
    for (const pr of batch) {
      const u = new Date(pr.updated_at).getTime();
      if (u > endMs) continue;
      if (u < startMs) {
        stop = true;
        break;
      }
      out.push({
        number: pr.number,
        title: String(pr.title ?? ""),
        state: String(pr.state ?? ""),
        user: pr.user?.login != null ? String(pr.user.login) : "",
        updated_at: String(pr.updated_at ?? ""),
        html_url: String(pr.html_url ?? ""),
      });
    }
    if (stop || batch.length < 100) break;
    page += 1;
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} [opts.cwd] git repo root for resolving origin
 * @param {Date} [opts.end] window end (default now)
 * @param {number} [opts.days] lookback days (default from POST_ACTIVITY_DAYS or 7)
 * @returns {Promise<{
 *   owner: string,
 *   repo: string,
 *   fullName: string,
 *   start: Date,
 *   end: Date,
 *   commits: Array<{ sha: string, message: string, author: string, date: string }>,
 *   pullRequests: Array<{ number: number, title: string, state: string, user: string, updated_at: string, html_url: string }>,
 * }>}
 */
async function fetchWeeklyRepoActivity(opts = {}) {
  const end = opts.end ?? new Date();
  const daysRaw = opts.days != null ? opts.days : Number(process.env.POST_ACTIVITY_DAYS) || 7;
  const days = Math.min(Math.max(1, Math.floor(daysRaw)), 90);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const { owner, repo } = resolveGithubActivityRepo(opts.cwd);
  const token = String(process.env.GITHUB_TOKEN ?? "").trim();
  const github = token ? createGithubClient(token) : getEnvGithubClient();

  const sinceIso = start.toISOString();
  const rawCommits = await listCommitsSince(github, owner, repo, sinceIso);
  const commits = rawCommits
    .map((c) => {
      const msg = String(c.commit?.message ?? "").split("\n")[0].trim();
      const author = String(c.commit?.author?.name ?? c.author?.login ?? "").trim();
      const date = String(c.commit?.author?.date ?? c.commit?.committer?.date ?? "").trim();
      const sha = String(c.sha ?? "").slice(0, 7);
      return { sha, message: msg, author, date };
    })
    .filter((c) => {
      if (!c.date) return true;
      const t = new Date(c.date).getTime();
      return t >= start.getTime() && t <= end.getTime();
    })
    .slice(0, 80);

  const pullRequests = await listPullsUpdatedInRange(github, owner, repo, start, end);

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    start,
    end,
    commits,
    pullRequests,
  };
}

module.exports = {
  parseGithubRemoteUrl,
  resolveGithubActivityRepo,
  fetchWeeklyRepoActivity,
};
