#!/usr/bin/env node
/**
 * Enqueue (or run) a sample LinkedIn member post (`POST /rest/posts`) using per-developer credentials.
 *
 * Requires: DATABASE_URL, developer with `linkedin_access_token_enc` and `linkedin_person_id`,
 *            REDIS_URL for enqueue, ENCRYPTION_MASTER_KEY if tokens are encrypted.
 * Token must include scope for posting (e.g. w_member_social per LinkedIn docs).
 *
 * Usage:
 *   node scripts/sampleLinkedInPost.js
 *   DEVELOPER_ID=2 node scripts/sampleLinkedInPost.js
 *   SAMPLE_POST_DIRECT=1 node scripts/sampleLinkedInPost.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const prisma = require('../src/db/prisma');
const { enqueueSocialMediaPost } = require('../src/social/enqueueSocialMediaPost');
const { queuesEnabled } = require('../src/queue/jobQueues');
const { executeSocialMediaPost } = require('../src/jobs/executeSocialMediaPost');

const SAMPLE_TEXT = [
  'GitHub Intel — sync your GitHub profile, portfolio, and LinkedIn data in one place.',
  'Automate README deploys and keep your developer story up to date.',
  'Built with github-intel-service.',
].join(' ');

function hasLinkedinCredentials(row) {
  if (!row) return false;
  const token = row.linkedinAccessTokenEnc;
  const pid = row.linkedinPersonId;
  const hasToken = Boolean(token && String(token).trim());
  const hasPerson = Boolean(pid && String(pid).trim());
  return hasToken && hasPerson;
}

function maskDbUrl() {
  const u = process.env.DATABASE_URL;
  if (!u) return '(DATABASE_URL unset)';
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || 'default'}/${parsed.pathname.replace(/^\//, '').split('/')[0] || '…'}`;
  } catch {
    return '(DATABASE_URL present)';
  }
}

async function resolveDeveloperId() {
  const devCount = await prisma.developer.count();
  const withLi = await prisma.developer.count({
    where: {
      linkedinAccessTokenEnc: { not: null },
      linkedinPersonId: { not: null },
    },
  });
  console.error(
    `DB: ${maskDbUrl()} — developers: ${devCount}, with LinkedIn token + person id: ${withLi}`,
  );

  const fromEnv = process.env.DEVELOPER_ID;
  if (fromEnv && String(fromEnv).trim()) {
    const id = Number(fromEnv);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Invalid DEVELOPER_ID=${fromEnv}`);
    }
    const row = await prisma.developer.findUnique({
      where: { id },
      select: { id: true, linkedinAccessTokenEnc: true, linkedinPersonId: true },
    });
    if (!hasLinkedinCredentials(row)) {
      throw new Error(
        `No LinkedIn API credentials for DEVELOPER_ID=${id}. Save ACCESS_TOKEN and PERSON_ID in dashboard Settings.`,
      );
    }
    return id;
  }

  const candidates = await prisma.developer.findMany({
    where: {
      linkedinAccessTokenEnc: { not: null },
      linkedinPersonId: { not: null },
    },
    select: { id: true, linkedinAccessTokenEnc: true, linkedinPersonId: true },
    orderBy: { id: 'asc' },
    take: 50,
  });
  const row = candidates.find((r) => hasLinkedinCredentials(r));
  if (!row) {
    throw new Error(
      'No developer with both linkedin_access_token_enc and linkedin_person_id set. Add credentials in Settings.',
    );
  }
  return row.id;
}

async function main() {
  const developerId = await resolveDeveloperId();
  const payload = { text: SAMPLE_TEXT };

  if (process.env.SAMPLE_POST_DIRECT === '1' || process.env.SAMPLE_POST_DIRECT === 'true') {
    const result = await executeSocialMediaPost({
      developerId,
      platform: 'linkedin',
      payload,
    });
    console.log('Posted directly:', JSON.stringify(result, null, 2));
    return;
  }

  if (!queuesEnabled()) {
    throw new Error(
      'Redis queue not available (set REDIS_URL). Or run with SAMPLE_POST_DIRECT=1 to post without BullMQ.',
    );
  }

  const job = await enqueueSocialMediaPost({ developerId, platform: 'linkedin', payload });
  console.log('Enqueued job id:', job.id, 'developerId:', developerId);
  console.log('Watch the server process (npm start) for worker output.');
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
