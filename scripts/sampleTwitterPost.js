#!/usr/bin/env node
/**
 * Enqueue (or run) a sample X (Twitter) post (`POST /2/tweets`) using OAuth 2.0 user tokens.
 *
 * Requires: DATABASE_URL, developer with `developer_twitter_auth_data` (after Connect X in dashboard),
 *            REDIS_URL for enqueue, ENCRYPTION_MASTER_KEY if tokens are encrypted.
 *
 * Usage:
 *   node scripts/sampleTwitterPost.js
 *   DEVELOPER_ID=2 node scripts/sampleTwitterPost.js
 *   SAMPLE_POST_DIRECT=1 npm run sample-twitter-post
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const prisma = require("../src/db/prisma");
const { enqueueSocialMediaPost } = require("../src/social/enqueueSocialMediaPost");
const { queuesEnabled } = require("../src/queue/jobQueues");
const { executeSocialMediaPost } = require("../src/jobs/executeSocialMediaPost");

const SAMPLE_TEXT =
  "GitHub Intel — sync your GitHub profile, portfolio, and LinkedIn data in one place. #buildinpublic";

function maskDbUrl() {
  const u = process.env.DATABASE_URL;
  if (!u) return "(DATABASE_URL unset)";
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || "default"}/${parsed.pathname.replace(/^\//, "").split("/")[0] || "…"}`;
  } catch {
    return "(DATABASE_URL present)";
  }
}

async function resolveDeveloperId() {
  const twCount = await prisma.developerTwitterAuthData.count();
  const devCount = await prisma.developer.count();
  console.error(`DB: ${maskDbUrl()} — developers: ${devCount}, developer_twitter_auth_data rows: ${twCount}`);

  const fromEnv = process.env.DEVELOPER_ID;
  if (fromEnv && String(fromEnv).trim()) {
    const id = Number(fromEnv);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Invalid DEVELOPER_ID=${fromEnv}`);
    }
    const row = await prisma.developerTwitterAuthData.findUnique({
      where: { developerId: id },
      select: { developerId: true },
    });
    if (!row) {
      throw new Error(
        `No developer_twitter_auth_data for DEVELOPER_ID=${id}. Connect X in Settings after setting TWITTER_CONSUMER_KEY / TWITTER_CONSUMER_SECRET.`,
      );
    }
    return id;
  }

  const row = await prisma.developerTwitterAuthData.findFirst({
    select: { developerId: true },
    orderBy: { id: "asc" },
  });
  if (!row) {
    throw new Error(
      `No developer_twitter_auth_data rows. Use the dashboard “Connect X” link after configuring Twitter OAuth env vars.`,
    );
  }
  return row.developerId;
}

async function main() {
  const developerId = await resolveDeveloperId();
  const payload = { text: SAMPLE_TEXT };

  if (process.env.SAMPLE_POST_DIRECT === "1" || process.env.SAMPLE_POST_DIRECT === "true") {
    const result = await executeSocialMediaPost({
      developerId,
      platform: "twitter",
      payload,
    });
    console.log("Posted directly:", JSON.stringify(result, null, 2));
    return;
  }

  if (!queuesEnabled()) {
    throw new Error(
      "Redis queue not available (set REDIS_URL). Or run with SAMPLE_POST_DIRECT=1 to post without BullMQ.",
    );
  }

  const job = await enqueueSocialMediaPost({ developerId, platform: "twitter", payload });
  console.log(
    "Enqueued job id:",
    job.id,
    "monitoring runId:",
    job.data?.runId,
    "developerId:",
    developerId,
  );
  console.log("Watch the server process (npm start) for worker output.");
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
