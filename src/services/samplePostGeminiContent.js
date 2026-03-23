/**
 * Build social post body text via Gemini from recent GitHub activity in this repo.
 *
 * Env: GEMINI_API_KEY (or GOOGLE_API_KEY), optional GITHUB_ACTIVITY_REPO, POST_ACTIVITY_DAYS
 * Set SAMPLE_POST_USE_STATIC=1 to skip Gemini/GitHub and use built-in static copy (tests/CI).
 */

const { generateContent } = require("./geminiGenerate");
const { fetchWeeklyRepoActivity } = require("./githubRepoWeeklyActivity");

const STATIC_LINKEDIN = [
  "GitHub Intel — sync your GitHub profile, portfolio, and LinkedIn data in one place.",
  "Automate README deploys and keep your developer story up to date.",
  "Built with github-intel-service.",
].join(" ");

const STATIC_FACEBOOK = STATIC_LINKEDIN;

const STATIC_TWITTER =
  "GitHub Intel — sync your GitHub profile, portfolio, and LinkedIn data in one place. #buildinpublic";

/** @param {'linkedin'|'facebook'|'twitter'} platform */
function staticBody(platform) {
  if (platform === "facebook") return STATIC_FACEBOOK;
  if (platform === "twitter") return STATIC_TWITTER;
  return STATIC_LINKEDIN;
}

function formatActivityForPrompt(activity) {
  const { fullName, start, end, commits, pullRequests } = activity;
  const commitLines = commits.length
    ? commits
        .slice(0, 40)
        .map((c) => `- ${c.sha} ${c.date} ${c.author}: ${c.message}`)
        .join("\n")
    : "(none)";

  const prLines = pullRequests.length
    ? pullRequests
        .slice(0, 40)
        .map((p) => `- #${p.number} [${p.state}] ${p.title} (@${p.user}) ${p.html_url}`)
        .join("\n")
    : "(none)";

  return `Repository: ${fullName}
Activity window (UTC): ${start.toISOString()} → ${end.toISOString()}

Recent commits (default branch, in window):
${commitLines}

Pull requests updated in window:
${prLines}`;
}

/**
 * @param {'linkedin'|'facebook'|'twitter'} platform
 * @param {{ cwd?: string }} [opts] cwd = monorepo root for git/GITHUB_ACTIVITY_REPO resolution
 */
async function generateSamplePostBody(platform, opts = {}) {
  if (process.env.SAMPLE_POST_USE_STATIC === "1" || process.env.SAMPLE_POST_USE_STATIC === "true") {
    return staticBody(platform);
  }

  const cwd = opts.cwd ?? pathJoinRepoRoot();
  const activity = await fetchWeeklyRepoActivity({ cwd });
  const bundle = formatActivityForPrompt(activity);

  const p = String(platform).toLowerCase();
  let instructions;
  if (p === "twitter") {
    instructions = `Write ONE tweet (max 280 characters including spaces). No markdown. 
Tone: developer #buildinpublic. Mention the repo name once if it fits.
If there was little activity, say so briefly (still under 280 chars).
Output ONLY the tweet text, no quotes.`;
  } else if (p === "facebook") {
    instructions = `Write a short Facebook Page post (2–4 sentences, plain text, no markdown).
Friendly, clear, about progress on this codebase. If activity is thin, acknowledge it honestly.
Output ONLY the post body.`;
  } else {
    instructions = `Write a LinkedIn post (3–6 short paragraphs or tight bullets; plain text, line breaks ok; no heavy markdown).
Professional tone: shipping updates on this open-source / product codebase. Credit themes from commits/PRs; do not invent features not implied by the data.
If activity is sparse, say so briefly and still sound constructive.
Output ONLY the post body.`;
  }

  const prompt = `You are helping promote ongoing work on the GitHub repository described below.

${bundle}

${instructions}`;

  let text = (await generateContent(prompt)).trim();
  if (p === "twitter" && text.length > 280) {
    text = text.slice(0, 277).trimEnd() + "…";
  }
  return text;
}

function pathJoinRepoRoot() {
  const path = require("path");
  return path.join(__dirname, "..", "..");
}

module.exports = {
  generateSamplePostBody,
  staticBody,
};
