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

function buildJobRunWhere({ jobType, developerId } = {}) {
  /** @type {{ jobType?: string; developerId?: number }} */
  const w = {};
  if (jobType) w.jobType = jobType;
  if (developerId != null) w.developerId = developerId;
  return Object.keys(w).length ? w : undefined;
}

async function countJobRuns({ jobType, developerId } = {}) {
  return prisma.jobRun.count({
    where: buildJobRunWhere({ jobType, developerId }),
  });
}

async function listJobRuns({ jobType, limit = 50, skip = 0, developerId } = {}) {
  const take = clampInt(limit, 1, 200, 50);
  const s = Math.max(0, Number(skip) || 0);
  return prisma.jobRun.findMany({
    where: buildJobRunWhere({ jobType, developerId }),
    take,
    skip: s,
    orderBy: { startedAt: "desc" },
  });
}

async function assertRunOwnedByDeveloper(runId, developerId) {
  if (developerId == null) return true;
  const run = await prisma.jobRun.findUnique({
    where: { id: String(runId) },
    select: { developerId: true },
  });
  return Boolean(run && run.developerId === developerId);
}

async function countJobEvents(runId, { developerId } = {}) {
  if (!runId) return 0;
  const rid = String(runId);
  if (developerId != null) {
    const ok = await assertRunOwnedByDeveloper(rid, developerId);
    if (!ok) return 0;
  }
  return prisma.jobEvent.count({ where: { runId: rid } });
}

/**
 * @returns {Promise<import("@prisma/client").JobEvent[] | null>} `null` when forbidden (scoped to developer).
 */
async function getJobEvents(runId, { limit = 200, skip = 0, developerId } = {}) {
  const rid = String(runId);
  if (developerId != null) {
    const ok = await assertRunOwnedByDeveloper(rid, developerId);
    if (!ok) return null;
  }
  const take = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const s = Math.max(0, Number(skip) || 0);
  return prisma.jobEvent.findMany({
    where: { runId: rid },
    take,
    skip: s,
    orderBy: { createdAt: "asc" },
  });
}

async function countFailures({ developerId } = {}) {
  return prisma.jobFailure.count({
    where: developerId != null ? { run: { developerId } } : undefined,
  });
}

async function listFailures({ limit = 100, skip = 0, developerId } = {}) {
  const take = clampInt(limit, 1, 500, 100);
  const s = Math.max(0, Number(skip) || 0);
  return prisma.jobFailure.findMany({
    where: developerId != null ? { run: { developerId } } : undefined,
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

async function healthSnapshot({ developerId } = {}) {
  const where = developerId != null ? { developerId } : undefined;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [lastSync, lastLinkedin, recentFailures, running] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobType: "sync", ...where },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobRun.findFirst({
      where: { jobType: "linkedin", ...where },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobFailure.count({
      where: {
        occurredAt: { gte: dayAgo },
        ...(developerId != null ? { run: { developerId } } : {}),
      },
    }),
    prisma.jobRun.count({
      where: { status: "running", ...where },
    }),
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
