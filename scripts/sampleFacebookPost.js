#!/usr/bin/env node
/**
 * Enqueue (or run) a sample Facebook **Page** post about this app (Graph `POST /{page-id}/feed`).
 * Personal profile timelines are not supported by Meta’s API for this use case.
 *
 * Requires: DATABASE_URL, developer with `developer_facebook_auth_data`, REDIS_URL for enqueue,
 *            ENCRYPTION_MASTER_KEY if tokens are encrypted.
 *
 * Post body: OpenAI (gpt-4o-mini) + this repo’s GitHub activity unless SAMPLE_POST_USE_STATIC=1.
 * See sampleLinkedInPost.js header for OPENAI_API_KEY / GITHUB_ACTIVITY_REPO / etc.
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

const FB_CONNECT_HELP = `
No Facebook Page token in the database yet. Do this once:

  1) Start the web app: npm start (PORT in .env; default 80 in code if unset).
  2) Sign in with GitHub in the browser (/auth/github). This app sets session.user.developerId only after GitHub OAuth — visiting the site alone is not enough.
  3) Open /auth/facebook (“Connect Facebook Page”). OAuth saves the Page to the same developerId as your session.
  4) Finish Meta login. Success: /dashboard?facebook=connected
     Failure: /dashboard?facebook_error=… (no_pages = Facebook Page you admin required; session = not logged in via GitHub; config = FACEBOOK_APP_ID/SECRET missing).

Debug: node scripts/diagnoseFacebookAuth.js

Then re-run this script. DEVELOPER_ID must match the developer row tied to the GitHub account you used in step 2.
`.trim();

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
      console.error(FB_CONNECT_HELP);
      throw new Error(
        `No developer_facebook_auth_data for DEVELOPER_ID=${id} (${fbCount} row(s) in table total).`,
      );
    }
    return id;
  }

  const row = await prisma.developerFacebookAuthData.findFirst({
    select: { developerId: true },
    orderBy: { id: 'asc' },
  });
  if (!row) {
    console.error(FB_CONNECT_HELP);
    throw new Error(`No developer_facebook_auth_data rows (developers in DB: ${devCount}).`);
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
