const prisma = require('../db/prisma');

function subscriptionBypassed() {
  return String(process.env.SUBSCRIPTION_BYPASS ?? '').trim() === '1';
}

/**
 * @param {number | null | undefined} developerId
 * @returns {Promise<boolean>}
 */
async function canRunPaidJobs(developerId) {
  if (subscriptionBypassed()) return true;
  if (developerId == null || Number.isNaN(Number(developerId))) return true;
  const d = await prisma.developer.findUnique({
    where: { id: developerId },
    select: { subscriptionStatus: true },
  });
  const s = d?.subscriptionStatus;
  if (s == null || s === '') return true;
  return s === 'active' || s === 'trialing';
}

/**
 * @param {number | null | undefined} developerId
 */
async function assertCanRunPaidJobs(developerId) {
  const ok = await canRunPaidJobs(developerId);
  if (!ok) {
    const err = new Error('Active subscription required. Please complete billing in Settings.');
    err.code = 'SUBSCRIPTION_REQUIRED';
    throw err;
  }
}

module.exports = {
  subscriptionBypassed,
  canRunPaidJobs,
  assertCanRunPaidJobs,
};
