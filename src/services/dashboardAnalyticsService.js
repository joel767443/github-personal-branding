const prisma = require("../db/prisma");

class DashboardAnalyticsService {
  getDashboardAnalytics = async (developerId) => {
    if (!developerId) return this.emptyStats();

    const [monitoring, techStacks, architectures, endorsements, experience] = await Promise.all([
      this.getMonitoringStats(developerId),
      this.getTechStackStats(developerId),
      this.getArchitectureStats(developerId),
      this.getEndorsementStats(developerId),
      this.getExperienceStats(developerId),
    ]);

    return {
      summary: {
        repos: await prisma.repo.count({ where: { developerId } }),
        commits: await prisma.commit.count({ where: { repo: { developerId } } }),
        skills: await prisma.developerLinkedinSkill.count({ where: { developerId } }),
        endorsements: await prisma.developerLinkedinReceivedEndorsement.count({ where: { developerId } }),
        recommendations: await prisma.developerRecommendation.count({ where: { developerId } }),
        experiences: await prisma.developerExperience.count({ where: { developerId } }),
        publications: await prisma.developerPublication.count({ where: { developerId } }),
        architecturesCatalog: await prisma.architecture.count(),
        developerTechStacks: techStacks.length,
        developerArchitectures: architectures.length,
      },
      monitoring,
      techStacks,
      architectures,
      endorsementsBySkill: endorsements,
      experience,
    };
  };

  getMonitoringStats = async (developerId) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [runsByDay, failuresByDay, jobStatus, jobType] = await Promise.all([
      prisma.$queryRaw`SELECT DATE(started_at) as date, COUNT(*)::int as count FROM job_runs WHERE developer_id = ${developerId} AND started_at >= ${thirtyDaysAgo} GROUP BY DATE(started_at) ORDER BY date ASC`,
      prisma.$queryRaw`SELECT DATE(occurred_at) as date, COUNT(*)::int as count FROM job_failures f JOIN job_runs r ON f.run_id = r.id WHERE r.developer_id = ${developerId} AND occurred_at >= ${thirtyDaysAgo} GROUP BY DATE(occurred_at) ORDER BY date ASC`,
      prisma.jobRun.groupBy({ by: ['status'], _count: true, where: { developerId, startedAt: { gte: thirtyDaysAgo } } }),
      prisma.jobRun.groupBy({ by: ['jobType'], _count: true, where: { developerId, startedAt: { gte: thirtyDaysAgo } } }),
    ]);

    return {
      runsByDay,
      failuresByDay,
      jobStatus: jobStatus.map(s => ({ status: s.status, count: s._count })),
      jobType: jobType.map(t => ({ jobType: t.jobType, count: t._count })),
      failures24h: await prisma.jobFailure.count({ where: { occurredAt: { gte: dayAgo }, run: { developerId } } }),
      runningJobs: await prisma.jobRun.count({ where: { developerId, status: 'running' } }),
    };
  };

  getTechStackStats = async (developerId) => {
    return prisma.developerTechStack.findMany({
      where: { developerId },
      orderBy: { percentage: 'desc' },
      take: 10
    });
  };

  getArchitectureStats = async (developerId) => {
    return prisma.developerArchitecture.findMany({
      where: { developerId },
      orderBy: { count: 'desc' },
      take: 10
    });
  };

  getEndorsementStats = async (developerId) => {
    const raw = await prisma.developerLinkedinReceivedEndorsement.groupBy({
      by: ['skillName'],
      _count: true,
      where: { developerId },
      orderBy: { _count: { skillName: 'desc' } },
      take: 10
    });
    return raw.map(r => ({ skillName: r.skillName, count: r._count }));
  };

  getExperienceStats = async (developerId) => {
    const roles = await prisma.developerExperience.findMany({
      where: { developerId },
      orderBy: { sortOrder: 'asc' },
      select: { title: true, company: true }
    });
    return { roles: roles.map(r => ({ label: `${r.title} at ${r.company}` })) };
  };

  emptyStats = () => {
    return { summary: {}, monitoring: { runsByDay: [], failuresByDay: [], jobStatus: [], jobType: [] }, techStacks: [], architectures: [], endorsementsBySkill: [], experience: { roles: [] } };
  };
}

module.exports = new DashboardAnalyticsService();
