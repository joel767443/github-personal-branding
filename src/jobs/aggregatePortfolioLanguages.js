const prisma = require('../db/prisma');

const SOURCE = 'github_aggregate';

/**
 * Previously rolled repo languages into a synthetic Project (source github_aggregate).
 * That project type is no longer created; this removes any legacy rows after sync.
 */
async function aggregatePortfolioLanguages({ developerId, onProgress } = {}) {
  if (developerId == null) return { languageCount: 0 };
  const progress = typeof onProgress === 'function' ? onProgress : () => {};

  const deleted = await prisma.project.deleteMany({
    where: { developerId, source: SOURCE },
  });

  progress('Portfolio GitHub aggregate projects cleared', { developerId, removed: deleted.count });
  return { languageCount: 0, removedProjects: deleted.count };
}

module.exports = aggregatePortfolioLanguages;
