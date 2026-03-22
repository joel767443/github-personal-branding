const prisma = require("../db/prisma");

async function startJobRun({ runId, jobType, userLogin = null, developerId = null, metadata = null }) {
  await prisma.jobRun.upsert({
    where: { id: runId },
    update: {
      jobType,
      status: "running",
      userLogin,
      developerId,
      metadata,
      startedAt: new Date(),
      finishedAt: null,
      summary: null,
    },
    create: {
      id: runId,
      jobType,
      status: "running",
      userLogin,
      developerId,
      metadata,
    },
  });
}

async function addJobEvent({ runId, level = "info", label, payload = null }) {
  if (!runId || !label) return;
  await prisma.jobEvent.create({
    data: {
      runId,
      level,
      label,
      payload,
    },
  });
}

async function failJobRun({ runId, message, code = null, details = null, stack = null }) {
  if (!runId) return;
  await prisma.$transaction([
    prisma.jobFailure.create({
      data: {
        runId,
        code,
        message: String(message ?? "Unknown failure"),
        details,
        stack: stack ? String(stack) : null,
      },
    }),
    prisma.jobRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        summary: String(message ?? "Failed"),
      },
    }),
  ]);
}

async function completeJobRun({ runId, summary = null, metadata = null }) {
  if (!runId) return;
  await prisma.jobRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      summary,
      metadata,
    },
  });
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(Math.floor(v), min), max);
}

async function countJobRuns({ jobType } = {}) {
  return prisma.jobRun.count({
    where: jobType ? { jobType } : undefined,
  });
}

async function listJobRuns({ jobType, limit = 50, skip = 0 } = {}) {
  const take = clampInt(limit, 1, 200, 50);
  const s = Math.max(0, Number(skip) || 0);
  return prisma.jobRun.findMany({
    where: jobType ? { jobType } : undefined,
    take,
    skip: s,
    orderBy: { startedAt: "desc" },
  });
}

async function countJobEvents(runId) {
  if (!runId) return 0;
  return prisma.jobEvent.count({ where: { runId: String(runId) } });
}

async function getJobEvents(runId, { limit = 200, skip = 0 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const s = Math.max(0, Number(skip) || 0);
  return prisma.jobEvent.findMany({
    where: { runId: String(runId) },
    take,
    skip: s,
    orderBy: { createdAt: "asc" },
  });
}

async function countFailures() {
  return prisma.jobFailure.count();
}

async function listFailures({ limit = 100, skip = 0 } = {}) {
  const take = clampInt(limit, 1, 500, 100);
  const s = Math.max(0, Number(skip) || 0);
  return prisma.jobFailure.findMany({
    take,
    skip: s,
    orderBy: { occurredAt: "desc" },
    include: {
      run: {
        select: {
          id: true,
          jobType: true,
          status: true,
          userLogin: true,
          developerId: true,
        },
      },
    },
  });
}

async function healthSnapshot() {
  const [lastSync, lastLinkedin, recentFailures, running] = await Promise.all([
    prisma.jobRun.findFirst({ where: { jobType: "sync" }, orderBy: { startedAt: "desc" } }),
    prisma.jobRun.findFirst({ where: { jobType: "linkedin" }, orderBy: { startedAt: "desc" } }),
    prisma.jobFailure.count({ where: { occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    prisma.jobRun.count({ where: { status: "running" } }),
  ]);
  return {
    lastSync,
    lastLinkedin,
    failures24h: recentFailures,
    runningJobs: running,
  };
}

module.exports = {
  startJobRun,
  addJobEvent,
  failJobRun,
  completeJobRun,
  listJobRuns,
  countJobRuns,
  getJobEvents,
  countJobEvents,
  listFailures,
  countFailures,
  healthSnapshot,
};
