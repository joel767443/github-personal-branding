const { importLinkedInExport } = require('../services/linkedinImportService');
const aggregatePortfolioLanguages = require('./aggregatePortfolioLanguages');

/**
 * @param {object} opts
 * @param {number} opts.developerId
 * @param {string} opts.zipPath
 * @param {(label: string, extra?: object) => void} [opts.onProgress]
 */
async function executeLinkedinImportPipeline({ developerId, zipPath, onProgress }) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const importResult = await importLinkedInExport({
    zipPath,
    developerId,
    onProgress: progress,
  });
  progress('LinkedIn: aggregating portfolio languages from GitHub repos', {
    phase: 'aggregate',
  });
  await aggregatePortfolioLanguages({ developerId, onProgress: progress });
  return importResult;
}

module.exports = { executeLinkedinImportPipeline };
