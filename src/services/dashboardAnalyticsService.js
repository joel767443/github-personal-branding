const prisma = require("../db/prisma");
const { formatJobTypeLabel } = require("../utils/jobTypeLabels");

const TOP_STACKS = 12;
const TOP_ARCH = 12;
const TOP_ENDORSE_SKILLS = 12;
const TOP_EXPERIENCE = 10;
const MONITORING_DAYS = 30;

function utcDayKey(d) {
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

function lastNDaysKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    keys.push(t.toISOString().slice(0, 10));
  }
  return keys;
}

function bucketCountsByDay(rows, getDate) {
  const map = new Map();
  for (const row of rows) {
    const k = utcDayKey(getDate(row));
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/**
 * @param {number} developerId
 */
async function getDashboardAnalytics(developerId) {
  const dayKeys = lastNDaysKeys(MONITORING_DAYS);
  const rangeStart = new Date(`${dayKeys[0]}T00:00:00.000Z`);
  const now = new Date();

  const jobWhere = { developerId };

  const [
    experiences,
    education,
    certifications,
    projects,
    skills,
    endorsementsCount,
    recommendations,
    publications,
    repos,
    endorsementGroups,
    techStacks,
    architectures,
    experienceRows,
    jobRunsInRange,
    failuresInRange,
    statusGroups,
    typeGroups,
    runningJobsCount,
    failures24hCount,
    lastSync,
    lastLinkedin,
    lastSocial,
    socialPostsCompleted30d,
    commitsCount,
    developerTechStacksCount,
    developerArchitecturesCount,
    architecturesCatalogCount,
    totalJobRuns,
  ] = await Promise.all([
    prisma.developerExperience.count({ where: { developerId } }),
    prisma.education.count({ where: { developerId } }),
    prisma.certification.count({ where: { developerId } }),
    prisma.project.count({ where: { developerId } }),
    prisma.developerLinkedinSkill.count({ where: { developerId } }),
    prisma.developerLinkedinReceivedEndorsement.count({ where: { developerId } }),
    prisma.developerRecommendation.count({ where: { developerId } }),
    prisma.developerPublication.count({ where: { developerId } }),
    prisma.repo.count({ where: { developerId } }),
    prisma.developerLinkedinReceivedEndorsement.groupBy({
      by: ["skillName"],
      where: { developerId, skillName: { not: null } },
      _count: true,
    }),
    prisma.developerTechStack.findMany({
      where: { developerId },
      orderBy: { percentage: "desc" },
      take: TOP_STACKS,
      select: { name: true, percentage: true },
    }),
    prisma.developerArchitecture.findMany({
      where: { developerId },
      orderBy: { count: "desc" },
      take: TOP_ARCH,
      select: { name: true, count: true },
    }),
    prisma.developerExperience.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      take: TOP_EXPERIENCE,
      select: { title: true, company: true },
    }),
    prisma.jobRun.findMany({
      where: {
        ...jobWhere,
        startedAt: { gte: rangeStart, lte: now },
      },
      select: { startedAt: true },
    }),
    prisma.jobFailure.findMany({
      where: {
        occurredAt: { gte: rangeStart, lte: now },
        run: { developerId },
      },
      select: { occurredAt: true },
    }),
    prisma.jobRun.groupBy({
      by: ["status"],
      where: jobWhere,
      _count: true,
    }),
    prisma.jobRun.groupBy({
      by: ["jobType"],
      where: jobWhere,
      _count: true,
    }),
    prisma.jobRun.count({ where: { ...jobWhere, status: "running" } }),
    prisma.jobFailure.count({
      where: {
        occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        run: { developerId },
      },
    }),
    prisma.jobRun.findFirst({
      where: { ...jobWhere, jobType: "sync" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobRun.findFirst({
      where: { ...jobWhere, jobType: "linkedin" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobRun.findFirst({
      where: { ...jobWhere, jobType: "social_media" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobRun.count({
      where: {
        ...jobWhere,
        jobType: "social_media",
        status: "completed",
        startedAt: { gte: rangeStart, lte: now },
      },
    }),
    prisma.commit.count({
      where: { repo: { developerId } },
    }),
    prisma.developerTechStack.count({ where: { developerId } }),
    prisma.developerArchitecture.count({ where: { developerId } }),
    prisma.architecture.count(),
    prisma.jobRun.count({ where: jobWhere }),
  ]);

  const runsByDayMap = bucketCountsByDay(jobRunsInRange, (r) => r.startedAt);
  const failuresByDayMap = bucketCountsByDay(failuresInRange, (r) => r.occurredAt);

  const runsByDay = dayKeys.map((d) => ({ date: d, count: runsByDayMap.get(d) ?? 0 }));
  const failuresByDay = dayKeys.map((d) => ({ date: d, count: failuresByDayMap.get(d) ?? 0 }));

  const endorsementsBySkill = endorsementGroups
    .filter((g) => g.skillName)
    .map((g) => ({ skillName: g.skillName, count: g._count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ENDORSE_SKILLS);

  const experienceBars = experienceRows.map((r) => {
    const t = (r.title || "").trim();
    const c = (r.company || "").trim();
    let label = t || c || "Role";
    if (t && c) label = `${t} — ${c}`;
    return { label, title: t || null, company: c || null };
  });

  return {
    summary: {
      experiences,
      education,
      certifications,
      projects,
      skills,
      endorsements: endorsementsCount,
      recommendations,
      publications,
      repos,
      commits: commitsCount,
      developerTechStacks: developerTechStacksCount,
      developerArchitectures: developerArchitecturesCount,
      architecturesCatalog: architecturesCatalogCount,
    },
    endorsementsBySkill,
    techStacks,
    architectures,
    experience: {
      count: experiences,
      roles: experienceBars,
    },
    monitoring: {
      runsByDay,
      failuresByDay,
      jobStatus: statusGroups.map((g) => ({ status: g.status, count: g._count })),
      jobType: typeGroups.map((g) => ({ jobType: g.jobType, count: g._count })),
      jobTypeChart: typeGroups.map((g) => ({
        jobType: g.jobType,
        count: g._count,
        label: formatJobTypeLabel(g.jobType, null),
      })),
      runningJobs: runningJobsCount,
      failures24h: failures24hCount,
      lastSyncStatus: lastSync?.status ?? null,
      lastImportStatus: lastLinkedin?.status ?? null,
      lastSocialStatus: lastSocial?.status ?? null,
      socialPosts30d: socialPostsCompleted30d,
      totalRuns: totalJobRuns,
    },
  };
}

module.exports = {
  getDashboardAnalytics,
};
