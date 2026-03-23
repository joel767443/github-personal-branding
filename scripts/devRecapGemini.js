#!/usr/bin/env node
/**
 * Rolling-window GitHub recap for a developer using Gemini.
 * Window length = Developer.syncFrequency (see subtractFrequencyFromDate).
 *
 * Env:
 *   DATABASE_URL, GEMINI_API_KEY (or GOOGLE_API_KEY)
 *   DEVELOPER_ID — optional if --developer-id is set
 *   GitHub: per-developer PAT or GITHUB_TOKEN (via getGithubCredentialsForDeveloper)
 *
 * Usage:
 *   node scripts/devRecapGemini.js --developer-id=1
 *   DEVELOPER_ID=1 node scripts/devRecapGemini.js
 *   node scripts/devRecapGemini.js --developer-id 2 --end=2025-03-23T12:00:00Z
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const prisma = require("../src/db/prisma");
const { getGithubCredentialsForDeveloper } = require("../src/services/developerCredentials");
const {
  createGithubClient,
  getRepos,
  getRepoReadmePlaintext,
  searchUserPullRequestsInRange,
} = require("../src/services/githubService");
const { subtractFrequencyFromDate } = require("../src/services/syncFrequencyHelpers");
const { generateContent } = require("../src/services/geminiGenerate");

const MAX_NEW_REPOS_WITH_README = 12;
const README_MAX_CHARS = 4000;
const PR_DISPLAY_MAX = 40;

function parseArgs(argv) {
  let developerId = null;
  let end = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--developer-id=")) {
      developerId = Number(a.split("=", 2)[1]);
    } else if (a === "--developer-id" && argv[i + 1]) {
      developerId = Number(argv[++i]);
    } else if (a.startsWith("--end=")) {
      end = new Date(a.slice("--end=".length));
    } else if (a === "--end" && argv[i + 1]) {
      end = new Date(argv[++i]);
    }
  }
  if (developerId == null || Number.isNaN(developerId)) {
    const fromEnv = process.env.DEVELOPER_ID;
    if (fromEnv && String(fromEnv).trim()) {
      developerId = Number(fromEnv);
    }
  }
  if (end != null && Number.isNaN(end.getTime())) {
    end = null;
  }
  return { developerId, end };
}

function truncate(s, max) {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…`;
}

function repoFullNameFromHtmlUrl(htmlUrl) {
  try {
    const u = new URL(htmlUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch {
    // ignore
  }
  return "";
}

function buildPrompt({
  developerLabel,
  syncFrequency,
  start,
  end,
  newRepos,
  pullRequests,
}) {
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const repoLines = newRepos.length
    ? newRepos
        .map((r) => {
          const excerpt = r.readmeExcerpt || "(No README or not accessible.)";
          return `- **${r.name}** (${r.url})\n  README excerpt:\n  ${excerpt.split("\n").join("\n  ")}`;
        })
        .join("\n\n")
    : "(No new repositories created in this window.)";

  const prLines = pullRequests.length
    ? pullRequests
        .slice(0, PR_DISPLAY_MAX)
        .map((p) => {
          const repo = repoFullNameFromHtmlUrl(p.html_url) || "—";
          return `- [${repo}] ${p.title} (${p.state}) — ${p.html_url}`;
        })
        .join("\n")
    : "(No pull requests matching the search in this window.)";

  return `You are summarizing a developer's GitHub activity for a short recap.

Developer: ${developerLabel}
Sync frequency setting: ${syncFrequency}
Reporting period (UTC): ${startIso} → ${endIso}. The window length matches their sync frequency (rolling lookback).

## New repositories created in this window (${newRepos.length})
${repoLines}

## Pull requests updated in this window (author is this developer; GitHub search)
${prLines}

Instructions:
- If there was no substantive activity (no new repos and no PRs, or only empty READMEs), write a brief 2–4 sentence note that there was little or no recorded activity in this period.
- Otherwise produce a concise markdown summary with:
  - **Shipped work / themes** — bullet list
  - **New repos** — one line per repo if any
  - **Notable PRs** — one line per item if any
  - **Follow-ups** — optional bullet list or "None"
- Do not invent repositories, PRs, or work not supported by the data above. Keep tone factual and professional.`;
}

async function main() {
  const { developerId, end: endArg } = parseArgs(process.argv);
  if (developerId == null || !Number.isFinite(developerId) || developerId <= 0) {
    throw new Error("Set --developer-id=N or DEVELOPER_ID in the environment.");
  }

  const end = endArg ?? new Date();
  const dev = await prisma.developer.findUnique({
    where: { id: developerId },
    select: {
      id: true,
      githubLogin: true,
      githubUsername: true,
      firstName: true,
      lastName: true,
      syncFrequency: true,
    },
  });
  if (!dev) {
    throw new Error(`No developer with id ${developerId}.`);
  }

  const login =
    (dev.githubUsername && String(dev.githubUsername).trim()) ||
    (dev.githubLogin && String(dev.githubLogin).trim()) ||
    null;
  if (!login) {
    throw new Error(
      "GitHub username is missing for this developer; reconnect GitHub OAuth or set github_username.",
    );
  }

  const creds = await getGithubCredentialsForDeveloper(developerId);
  if (!creds?.token) {
    throw new Error(
      "GitHub API token is not configured. Save a GitHub PAT in Account settings, or set GITHUB_TOKEN for a shared fallback.",
    );
  }

  const start = subtractFrequencyFromDate(end, dev.syncFrequency);
  const github = createGithubClient(creds.token);
  const repos = await getRepos(github, login);

  const tStart = start.getTime();
  const tEnd = end.getTime();
  const newReposRaw = repos.filter((r) => {
    const c = r?.created_at ? new Date(r.created_at).getTime() : NaN;
    return Number.isFinite(c) && c >= tStart && c <= tEnd;
  });

  const sorted = [...newReposRaw].sort((a, b) => {
    const ca = new Date(a.created_at).getTime();
    const cb = new Date(b.created_at).getTime();
    return cb - ca;
  });

  const newRepos = [];
  for (const r of sorted.slice(0, MAX_NEW_REPOS_WITH_README)) {
    const owner = r?.owner?.login ?? login;
    const name = r?.name ?? "";
    let readmeExcerpt = "";
    try {
      const raw = await getRepoReadmePlaintext(github, owner, name);
      readmeExcerpt = raw ? truncate(raw, README_MAX_CHARS) : "";
    } catch (err) {
      readmeExcerpt = `(Could not load README: ${String(err?.message ?? err).slice(0, 200)})`;
    }
    newRepos.push({
      name: r.full_name || `${owner}/${name}`,
      url: r.html_url || "",
      readmeExcerpt,
    });
  }

  const pullRequests = await searchUserPullRequestsInRange(github, login, start, end, {
    maxResults: 80,
  });

  const developerLabel =
    [dev.firstName, dev.lastName].filter(Boolean).join(" ").trim() || login;

  const prompt = buildPrompt({
    developerLabel,
    syncFrequency: dev.syncFrequency,
    start,
    end,
    newRepos,
    pullRequests,
  });

  const answer = await generateContent(prompt);
  console.log(answer);
}

main()
  .then(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e?.message ?? e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
