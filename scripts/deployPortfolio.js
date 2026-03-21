#!/usr/bin/env node
/**
 * Deploy generated portfolio files from ./portfolio to a GitHub repo (profile README).
 *
 * CLI:
 *   node scripts/deployPortfolio.js
 *   node scripts/deployPortfolio.js --regenerate
 *
 * The API’s deploy runner sets DEPLOY_PORTFOLIO_AFTER_SYNC per developer from the database (not from a shared
 * `.env`). Set DEPLOY_REPO_URL in the server environment for portfolio deploy. Branch defaults to `main` unless you
 * set DEPLOY_BRANCH in the environment.
 *
 * Manual CLI (optional): DEPLOY_REPO_URL, DEPLOY_BRANCH, DEPLOY_README_REMOTE, PORTFOLIO_DEVELOPER_ID.
 *
 * Push this service’s own code with `npm run push:origin` (uses remote origin, e.g. github-personal-branding).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORTFOLIO_DIR = path.join(ROOT, "portfolio");

const DEFAULT_REPO = "";
const DEFAULT_BRANCH = "main";
/** Remote name for the README/profile repo clone (not the service repo’s `origin`). */
const DEFAULT_README_REMOTE = "readme";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    regenerate: args.includes("--regenerate") || args.includes("-r"),
    developerId: (() => {
      const i = args.findIndex((a) => a === "--developer-id" || a === "-d");
      if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
      return null;
    })(),
  };
}

function runGit(cwd, args, gitInherit = true) {
  const r = spawnSync("git", args, {
    cwd,
    stdio: gitInherit ? "inherit" : ["ignore", "pipe", "pipe"],
    encoding: gitInherit ? undefined : "utf8",
  });
  if (r.status !== 0) {
    const detail = !gitInherit && r.stderr ? String(r.stderr).trim() : "";
    const err = new Error(
      `git ${args.join(" ")} failed with ${r.status}${detail ? `: ${detail}` : ""}`,
    );
    err.status = r.status;
    throw err;
  }
  return r;
}

function hasConflictMarkers(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const t = fs.readFileSync(filePath, "utf8");
  return t.includes("<<<<<<<");
}

async function regeneratePortfolio({ developerId }) {
  require("dotenv").config({ path: path.join(ROOT, ".env") });
  const prisma = require("../src/db/prisma");
  const generatePortfolioOutput = require("../src/jobs/generatePortfolioOutput");
  try {
    let id = developerId;
    if (id == null || Number.isNaN(id)) {
      const dev = await prisma.developer.findFirst({ orderBy: { id: "asc" } });
      if (!dev) throw new Error("No developer in database; cannot regenerate.");
      id = dev.id;
    }
    await generatePortfolioOutput({
      developerId: id,
      onProgress: (label, extra) => console.log(label, extra != null ? extra : ""),
    });
    console.log(`Regenerated portfolio for developerId=${id}`);
  } finally {
    await prisma.$disconnect();
  }
}

function copyPortfolioInto(cloneDir) {
  const files = ["README.md", "index.html", "skills_chart.png"];
  for (const f of files) {
    const from = path.join(PORTFOLIO_DIR, f);
    if (!fs.existsSync(from)) {
      throw new Error(`Missing ${from}; run portfolio generation first.`);
    }
    fs.copyFileSync(from, path.join(cloneDir, f));
  }
  const imgSrc = path.join(PORTFOLIO_DIR, "img");
  const imgDest = path.join(cloneDir, "img");
  if (fs.existsSync(imgSrc)) {
    fs.rmSync(imgDest, { recursive: true, force: true });
    fs.cpSync(imgSrc, imgDest, { recursive: true });
  }
}

function resolveReadmeFromPortfolio(cloneDir) {
  fs.copyFileSync(path.join(PORTFOLIO_DIR, "README.md"), path.join(cloneDir, "README.md"));
}

function commitIfNeeded(cloneDir, log, gitInherit) {
  runGit(cloneDir, ["add", "README.md", "index.html", "skills_chart.png"], gitInherit);
  const imgDest = path.join(cloneDir, "img");
  if (fs.existsSync(imgDest)) {
    runGit(cloneDir, ["add", "img"], gitInherit);
  }
  const st = spawnSync("git", ["status", "--porcelain"], { cwd: cloneDir, encoding: "utf8" });
  if (!st.stdout.trim()) {
    log("No changes to commit; remote already matches portfolio output.");
    return false;
  }
  runGit(cloneDir, ["commit", "-m", "Update portfolio from github-intel-service"], gitInherit);
  return true;
}

function pullRebaseWithReadmeFix(cloneDir, branch, remote, env, log, gitInherit) {
  try {
    runGit(cloneDir, ["pull", "--rebase", remote, branch], gitInherit);
  } catch (e) {
    const readmePath = path.join(cloneDir, "README.md");
    if (hasConflictMarkers(readmePath)) {
      log("Resolving README.md conflict using generated portfolio/README.md");
      resolveReadmeFromPortfolio(cloneDir);
      runGit(cloneDir, ["add", "README.md"], gitInherit);
      const r = spawnSync("git", ["rebase", "--continue"], {
        cwd: cloneDir,
        stdio: gitInherit ? "inherit" : ["ignore", "pipe", "pipe"],
        encoding: gitInherit ? undefined : "utf8",
        env: { ...process.env, ...env, GIT_EDITOR: "true" },
      });
      if (r.status !== 0) throw e;
    } else {
      throw e;
    }
  }
}

/**
 * Clone target repo, copy ./portfolio into it, commit and push.
 * @param {object} [options]
 * @param {(msg: string, extra?: object) => void} [options.log] — default console.log
 * @param {string} [options.repoUrl]
 * @param {string} [options.branch]
 * @param {string} [options.readmeRemote] — remote name for README repo (default readme)
 * @param {boolean} [options.gitInherit] — pass git output to terminal (default true)
 * @returns {{ pushed: boolean, skipped: boolean, message?: string }}
 */
function deployPortfolioFiles(options = {}) {
  const log =
    typeof options.log === "function"
      ? options.log
      : (msg, extra) => {
          if (extra != null) console.log(msg, extra);
          else console.log(msg);
        };
  const gitInherit = options.gitInherit !== false;
  const repoUrl = String(options.repoUrl || process.env.DEPLOY_REPO_URL || DEFAULT_REPO).trim();
  const branch = options.branch || process.env.DEPLOY_BRANCH || DEFAULT_BRANCH;
  const readmeRemote =
    options.readmeRemote ||
    process.env.DEPLOY_README_REMOTE ||
    DEFAULT_README_REMOTE;

  if (!repoUrl) {
    throw new Error(
      "DEPLOY_REPO_URL is not set. Set it in the environment (or pass repoUrl) for portfolio deploy.",
    );
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-deploy-"));
  const cloneDir = path.join(tmpBase, "repo");
  try {
    log(`Portfolio deploy: cloning ${repoUrl} (remote ${readmeRemote}) …`);
    runGit(tmpBase, ["clone", "-o", readmeRemote, repoUrl, cloneDir], gitInherit);

    log("Portfolio deploy: copying portfolio files …");
    copyPortfolioInto(cloneDir);

    const committed = commitIfNeeded(cloneDir, log, gitInherit);
    if (!committed) {
      log("Portfolio deploy: done (nothing to push).");
      return { pushed: false, skipped: true, message: "no_changes" };
    }

    const gitEnv = { GIT_EDITOR: "true" };
    try {
      runGit(cloneDir, ["push", readmeRemote, branch], gitInherit);
    } catch (firstPush) {
      log(`Portfolio deploy: push rejected; rebasing onto ${readmeRemote} …`);
      pullRebaseWithReadmeFix(cloneDir, branch, readmeRemote, gitEnv, log, gitInherit);
      runGit(cloneDir, ["push", readmeRemote, branch], gitInherit);
    }

    log(`Portfolio deploy: pushed to ${repoUrl} (${branch}).`);
    return { pushed: true, skipped: false };
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

async function main() {
  const opts = parseArgs();
  const devIdFromEnv = process.env.PORTFOLIO_DEVELOPER_ID
    ? Number(process.env.PORTFOLIO_DEVELOPER_ID)
    : null;

  if (opts.regenerate) {
    await regeneratePortfolio({
      developerId: opts.developerId ?? (Number.isFinite(devIdFromEnv) ? devIdFromEnv : null),
    });
  }

  deployPortfolioFiles({ gitInherit: true });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  deployPortfolioFiles,
  DEFAULT_REPO,
  DEFAULT_BRANCH,
  DEFAULT_README_REMOTE,
};
