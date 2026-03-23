#!/usr/bin/env node
/**
 * Enqueue (or run) a sample Facebook **Page** post about this app (Graph `POST /{page-id}/feed`).
 * Personal profile timelines are not supported by Meta’s API for this use case.
 *
 * Requires: DATABASE_URL, developer with `developer_facebook_auth_data`, REDIS_URL for enqueue,
 *            ENCRYPTION_MASTER_KEY if tokens are encrypted.
 *
 * Post body: Gemini + this repo’s GitHub activity unless SAMPLE_POST_USE_STATIC=1.
 * See sampleLinkedInPost.js header for GEMINI_API_KEY / GITHUB_ACTIVITY_REPO / etc.
 *
 * Usage:
 *   node scripts/sampleFacebookPost.js
 *   DEVELOPER_ID=2 node scripts/sampleFacebookPost.js
 *   SAMPLE_POST_DIRECT=1 node scripts/sampleFacebookPost.js   # bypass queue; calls Graph API in-process
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const prisma = require('../src/db/prisma');
const { enqueueSocialMediaPost } = require('../src/social/enqueueSocialMediaPost');
const { queuesEnabled } = require('../src/queue/jobQueues');
const { executeSocialMediaPost } = require('../src/jobs/executeSocialMediaPost');
const { generateSamplePostBody } = require('../src/services/samplePostGeminiContent');

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
  const fbCount = await prisma.developerFacebookAuthData.count();
  const devCount = await prisma.developer.count();
  console.error(`DB: ${maskDbUrl()} — developers: ${devCount}, developer_facebook_auth_data rows: ${fbCount}`);

  const fromEnv = process.env.DEVELOPER_ID;
  if (fromEnv && String(fromEnv).trim()) {
    const id = Number(fromEnv);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Invalid DEVELOPER_ID=${fromEnv}`);
    }
    const row = await prisma.developerFacebookAuthData.findUnique({
      where: { developerId: id },
      select: { developerId: true },
    });
    if (!row) {
      throw new Error(
        `No developer_facebook_auth_data for DEVELOPER_ID=${id}. ` +
          `Table has ${fbCount} row(s). Re-run "Connect Facebook" and check the dashboard URL: ` +
          `?facebook=connected means saved; ?facebook_error=… explains failures (e.g. no_pages, session).`,
      );
    }
    return id;
  }

  const row = await prisma.developerFacebookAuthData.findFirst({
    select: { developerId: true },
    orderBy: { id: 'asc' },
  });
  if (!row) {
    throw new Error(
      `No developer_facebook_auth_data rows (developers in DB: ${devCount}). ` +
        `After OAuth, the URL must be /dashboard?facebook=connected — if you see facebook_error=…, ` +
        `the row was not saved. Common: no_pages (no Facebook Page admin), session (lost cookie), token.`,
    );
  }
  return row.developerId;
}

async function main() {
  const developerId = await resolveDeveloperId();
  const message = await generateSamplePostBody('facebook', { cwd: path.join(__dirname, '..') });
  const payload = { message };

  if (process.env.SAMPLE_POST_DIRECT === '1' || process.env.SAMPLE_POST_DIRECT === 'true') {
    const result = await executeSocialMediaPost({
      developerId,
      platform: 'facebook',
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

  const job = await enqueueSocialMediaPost({ developerId, platform: 'facebook', payload });
  console.log(
    'Enqueued job id:',
    job.id,
    'monitoring runId:',
    job.data?.runId,
    'developerId:',
    developerId,
  );
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
