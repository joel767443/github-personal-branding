const path = require('path');
const { spawnSync } = require('child_process');
const prisma = require('../db/prisma');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEPLOY_PORTFOLIO_SCRIPT = path.join(REPO_ROOT, 'scripts', 'deployPortfolio.js');

/**
 * Merge per-developer deploy env for portfolio push script.
 * @param {number | null | undefined} developerId
 * @returns {Promise<NodeJS.ProcessEnv>}
 */
async function buildDeployProcessEnv(developerId) {
  const env = { ...process.env };
  if (developerId == null || Number.isNaN(Number(developerId))) {
    return env;
  }
  env.PORTFOLIO_DEVELOPER_ID = String(developerId);
  const dev = await prisma.developer.findUnique({
    where: { id: developerId },
    select: {
      deployPortfolioAfterSync: true,
      deployRepoUrl: true,
    },
  });
  if (dev) {
    env.DEPLOY_PORTFOLIO_AFTER_SYNC = dev.deployPortfolioAfterSync !== false ? '1' : '0';
    const repo = String(dev.deployRepoUrl ?? '').trim();
    if (repo) {
      env.DEPLOY_REPO_URL = repo;
    }
  }
  return env;
}

/**
 * Run `node scripts/deployPortfolio.js` with env aligned to developer settings.
 * @param {(label: string, extra?: object) => void} onProgress
 * @param {number | null | undefined} developerId
 */
async function runDeployPortfolioCli(onProgress, developerId) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const env = await buildDeployProcessEnv(developerId);
  const r = spawnSync(process.execPath, [DEPLOY_PORTFOLIO_SCRIPT], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const combined = [r.stdout, r.stderr].filter(Boolean).join('\n');
  for (const line of combined.split(/\r?\n/)) {
    const t = line.trim();
    if (t) progress(t);
  }
  if (r.status !== 0) {
    const msg =
      r.stderr?.trim() ||
      r.stdout?.trim() ||
      `deployPortfolio.js exited with code ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
}

module.exports = {
  buildDeployProcessEnv,
  runDeployPortfolioCli,
};
