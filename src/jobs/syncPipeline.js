const prisma = require('../db/prisma');
const syncGithub = require('./syncGithub');
const aggregatePortfolioLanguages = require('./aggregatePortfolioLanguages');
const detectTechStacks = require('./detectTechStacks');
const detectDeveloperArchitectures = require('./detectDeveloperArchitectures');
const generatePortfolioOutput = require('./generatePortfolioOutput');
const { runDeployPortfolioCli } = require('../services/deployPortfolioRunner');
const { addFrequencyToDate } = require('../services/syncFrequencyHelpers');

/**
 * @param {object} opts
 * @param {number | null} opts.developerId Session developer id (optional before first sync)
 * @param {(label: string, extra?: object) => void} opts.onProgress
 * @param {import('express').Request | null} [opts.req]
 */
async function executeSyncPipeline({ developerId, onProgress, req }) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};

  const syncResult = await syncGithub({ onProgress: progress, developerId });
  const resolvedDeveloperId = syncResult?.developerId ?? null;

  if (resolvedDeveloperId != null) {
    await aggregatePortfolioLanguages({ developerId: resolvedDeveloperId, onProgress: progress });
  }
  await detectTechStacks({ onProgress: progress });

  await detectDeveloperArchitectures({ branch: 'main', onProgress: progress });

  if (resolvedDeveloperId != null) {
    await generatePortfolioOutput({ developerId: resolvedDeveloperId, onProgress: progress });

    const deployTarget = await prisma.developer.findUnique({
      where: { id: resolvedDeveloperId },
      select: { deployRepoUrl: true },
    });
    const devUrl = String(deployTarget?.deployRepoUrl ?? '').trim();
    const serverUrl = String(process.env.DEPLOY_REPO_URL ?? '').trim();
    if (devUrl || serverUrl) {
      await runDeployPortfolioCli(progress, resolvedDeveloperId);
    }
  }

  if (req?.session) {
    req.session.wizardStep = 'upload';
    await new Promise((resolve) => req.session.save(() => resolve()));
  }

  if (resolvedDeveloperId != null) {
    const dev = await prisma.developer.findUnique({
      where: { id: resolvedDeveloperId },
      select: { nextScheduledSyncAt: true, syncFrequency: true },
    });
    if (dev?.nextScheduledSyncAt == null) {
      await prisma.developer.update({
        where: { id: resolvedDeveloperId },
        data: {
          nextScheduledSyncAt: addFrequencyToDate(new Date(), dev.syncFrequency),
        },
      });
    }
  }
}

module.exports = { executeSyncPipeline };
