const prisma = require("../db/prisma");
const { resolveDeveloperFromSession } = require("./sessionDeveloperService");
const { endorsementApiOmit } = require("../constants/apiResponseOmit");
const { parsePage, paginateArray, PAGINATION_PARAMS } = require("./viewHelpers");
const {
  listJobRuns,
  getJobEvents,
  countJobEvents,
  listFailures,
  healthSnapshot,
  countJobRuns,
  countFailures,
} = require("./monitoringService");
const {
  omitId,
  omitIdDeveloperId,
  omitIdDeveloperSort,
  safeJson,
} = require("../utils/prismaJson");

const PAGE_SIZE_CV = 4;
const PAGE_SIZE_REPOS_GRID = 16;
const PAGE_SIZE_TABLE = 15;

async function currentDeveloperId(req) {
  const resolved = await resolveDeveloperFromSession(req);
  if (!resolved.email) {
    const err = new Error("Missing profile email");
    err.status = 400;
    err.details = "Unable to derive email from session";
    throw err;
  }
  if (!resolved.developer) {
    const err = new Error("No developer record");
    err.status = 404;
    err.details = "Run GitHub sync first so a developer profile exists for this account";
    throw err;
  }
  return resolved.developer.id;
}

async function getProfileViewModel(req) {
  const developerId = await currentDeveloperId(req);

  const developer = await prisma.developer.findUnique({
    where: { id: developerId },
    omit: { id: true },
  });

  const sessionUser = req.session?.user ?? {};
  const fullName = [developer?.firstName, developer?.lastName].filter(Boolean).join(" ");

  return {
    profile: {
      name: fullName || sessionUser?.login || developer?.email || "",
      avatarUrl: developer?.profilePic || sessionUser?.avatarUrl || "",
      email: developer?.email || sessionUser?.email || "",
      phoneNumber: developer?.mobileNumber || "",
      jobTitle: developer?.jobTitle || "",
      hireable: developer?.hireable ?? null,
      headline: developer?.headline || "",
      summary: developer?.summary || "",
      linkedinSummary: developer?.linkedinSummary || "",
      createdAt: developer?.createdAt ? new Date(developer.createdAt).toISOString() : null,
      updatedAt: developer?.updatedAt ? new Date(developer.updatedAt).toISOString() : null,
    },
  };
}

async function getExperienceViewModel(req) {
  const developerId = await currentDeveloperId(req);
  const rows = await prisma.developerExperience.findMany({
    where: { developerId },
  });

  const sorted = [...rows].sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0));
  const mapped = sorted.map((r) => ({
    title: r?.title ?? "",
    company: r?.company ?? "",
    dates: r?.dates ?? "",
    location: r?.location ?? "",
    description: r?.description ?? "",
  }));
  const pr = paginateArray(mapped, {
    page: parsePage(req.query[PAGINATION_PARAMS.experience]),
    pageSize: PAGE_SIZE_CV,
  });
  return {
    rows: pr.slice,
    pagination: {
      paramName: PAGINATION_PARAMS.experience,
      page: pr.page,
      pageSize: pr.pageSize,
      total: pr.total,
      totalPages: pr.totalPages,
    },
  };
}

function normalizeActiveTab(activeTab, allowed, fallback) {
  if (typeof activeTab === "string" && allowed.has(activeTab)) return activeTab;
  return fallback;
}

async function getEducationTabsViewModel(req, activeTab) {
  const developerId = await currentDeveloperId(req);
  const allowedTabs = new Set(["education", "certifications", "publications"]);
  const initialTab = normalizeActiveTab(activeTab, allowedTabs, "education");

  const [education, certifications, publications] = await Promise.all([
    prisma.education.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      omit: omitIdDeveloperSort,
    }),
    prisma.certification.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      omit: omitIdDeveloperSort,
    }),
    prisma.developerPublication.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      omit: omitIdDeveloperSort,
    }),
  ]);

  return { activeTab: initialTab, education, certifications, publications };
}

async function getSkillsTabsViewModel(req, activeTab) {
  const developerId = await currentDeveloperId(req);
  const allowedTabs = new Set(["skills", "developer-tech-stacks", "architectures"]);
  const initialTab = normalizeActiveTab(activeTab, allowedTabs, "skills");

  const [skillsRaw, developerTechStacksRaw, architecturesRaw, reposCount] = await Promise.all([
    prisma.developerLinkedinSkill.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      omit: omitIdDeveloperSort,
    }),
    prisma.developerTechStack.findMany({
      where: { developerId },
      orderBy: { percentage: "desc" },
      omit: omitIdDeveloperId,
    }),
    prisma.developerArchitecture.findMany({
      where: { developerId },
      omit: omitIdDeveloperId,
      include: { architecture: { omit: omitId } },
      orderBy: { count: "desc" },
    }),
    prisma.repo.count({ where: { developerId } }),
  ]);

  const skillsPr = paginateArray(skillsRaw, {
    page: parsePage(req.query[PAGINATION_PARAMS.skills]),
    pageSize: PAGE_SIZE_TABLE,
  });
  const dtsPr = paginateArray(developerTechStacksRaw, {
    page: parsePage(req.query[PAGINATION_PARAMS.developerTechStacks]),
    pageSize: PAGE_SIZE_TABLE,
  });
  const archSorted = [...architecturesRaw].sort(
    (a, b) => Number(b?.count ?? 0) - Number(a?.count ?? 0),
  );
  const archPr = paginateArray(archSorted, {
    page: parsePage(req.query[PAGINATION_PARAMS.architectures]),
    pageSize: PAGE_SIZE_TABLE,
  });

  return {
    activeTab: initialTab,
    skills: skillsPr.slice,
    developerTechStacks: dtsPr.slice,
    architectures: archPr.slice,
    overview: { repos: reposCount },
    skillsPagination: {
      paramName: PAGINATION_PARAMS.skills,
      page: skillsPr.page,
      pageSize: skillsPr.pageSize,
      total: skillsPr.total,
      totalPages: skillsPr.totalPages,
    },
    developerTechStacksPagination: {
      paramName: PAGINATION_PARAMS.developerTechStacks,
      page: dtsPr.page,
      pageSize: dtsPr.pageSize,
      total: dtsPr.total,
      totalPages: dtsPr.totalPages,
    },
    architecturesPagination: {
      paramName: PAGINATION_PARAMS.architectures,
      page: archPr.page,
      pageSize: archPr.pageSize,
      total: archPr.total,
      totalPages: archPr.totalPages,
    },
  };
}

async function getEndorsementsViewModel(req) {
  const developerId = await currentDeveloperId(req);

  const endorsementsRaw = await prisma.developerLinkedinReceivedEndorsement.findMany({
    where: { developerId },
    orderBy: { sortOrder: "asc" },
    omit: { ...omitIdDeveloperSort, ...endorsementApiOmit },
  });

  const endPr = paginateArray(endorsementsRaw, {
    page: parsePage(req.query[PAGINATION_PARAMS.endorsements]),
    pageSize: PAGE_SIZE_TABLE,
  });

  return {
    endorsements: endPr.slice,
    endorsementsPagination: {
      paramName: PAGINATION_PARAMS.endorsements,
      page: endPr.page,
      pageSize: endPr.pageSize,
      total: endPr.total,
      totalPages: endPr.totalPages,
    },
  };
}

function resolveProjectUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return { href: "", text: "" };
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { href: "", text: raw };
    return { href: u.href, text: raw };
  } catch {
    return { href: "", text: raw };
  }
}

function formatPercentage(n) {
  const num = Number(n ?? 0);
  return num.toFixed(2);
}

function normalizeProjects(projectsRaw) {
  return safeJson(projectsRaw).map((r) => {
    const url = resolveProjectUrl(r?.url);
    return {
      ...r,
      urlHref: url.href,
      urlText: url.text,
    };
  });
}

async function getPortfolioTabsViewModel(req, activeTab) {
  const developerId = await currentDeveloperId(req);
  const allowedTabs = new Set(["repos", "projects"]);
  const initialTab = normalizeActiveTab(activeTab, allowedTabs, "repos");

  const [reposRaw, projectsRaw] = await Promise.all([
    prisma.repo.findMany({
      where: { developerId },
      omit: omitIdDeveloperId,
      include: {
        languages: { omit: omitId },
        repoTechStacks: { omit: omitId, orderBy: { score: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.findMany({
      where: { developerId },
      omit: omitIdDeveloperSort,
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const repos = safeJson(reposRaw).map((repo) => {
    const name = repo?.name ?? repo?.fullName ?? "Unnamed repo";
    const url = resolveProjectUrl(repo?.url);

    const languages = Array.isArray(repo?.languages) ? [...repo.languages] : [];
    const topLanguages = languages
      .sort((a, b) => Number(b?.percentage ?? 0) - Number(a?.percentage ?? 0))
      .slice(0, 4)
      .map((lang) => `${lang?.name ?? "Unknown"} (${formatPercentage(lang?.percentage) }%)`);

    const visibility = repo?.private ? "Private" : "Public";

    return {
      ...repo,
      name,
      urlHref: url.href,
      urlText: url.text,
      visibility,
      topLanguagesText: topLanguages.length > 0 ? topLanguages.join(", ") : "No language data",
    };
  });

  const projects = normalizeProjects(projectsRaw);

  const reposPr = paginateArray(repos, {
    page: parsePage(req.query[PAGINATION_PARAMS.portfolioRepos]),
    pageSize: PAGE_SIZE_REPOS_GRID,
  });
  const projectsPr = paginateArray(projects, {
    page: parsePage(req.query[PAGINATION_PARAMS.portfolioProjects]),
    pageSize: PAGE_SIZE_CV,
  });

  return {
    activeTab: initialTab,
    repos: reposPr.slice,
    projects: projectsPr.slice,
    reposPagination: {
      paramName: PAGINATION_PARAMS.portfolioRepos,
      page: reposPr.page,
      pageSize: reposPr.pageSize,
      total: reposPr.total,
      totalPages: reposPr.totalPages,
    },
    projectsPagination: {
      paramName: PAGINATION_PARAMS.portfolioProjects,
      page: projectsPr.page,
      pageSize: projectsPr.pageSize,
      total: projectsPr.total,
      totalPages: projectsPr.totalPages,
    },
  };
}

async function getProjectsViewModel(req) {
  const developerId = await currentDeveloperId(req);
  const projectsRaw = await prisma.project.findMany({
    where: { developerId },
    omit: omitIdDeveloperSort,
    orderBy: { sortOrder: "asc" },
  });
  return { projects: normalizeProjects(projectsRaw) };
}

async function getReposViewModel(req) {
  const developerId = await currentDeveloperId(req);
  const reposRaw = await prisma.repo.findMany({
    where: { developerId },
    omit: omitIdDeveloperId,
    include: {
      languages: { omit: omitId },
      repoTechStacks: { omit: omitId, orderBy: { score: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const repos = safeJson(reposRaw).map((repo) => {
    const name = repo?.name ?? repo?.fullName ?? "Unnamed repo";
    const url = resolveProjectUrl(repo?.url);

    const languages = Array.isArray(repo?.languages) ? [...repo.languages] : [];
    const topLanguages = languages
      .sort((a, b) => Number(b?.percentage ?? 0) - Number(a?.percentage ?? 0))
      .slice(0, 4)
      .map((lang) => `${lang?.name ?? "Unknown"} (${formatPercentage(lang?.percentage) }%)`);

    const visibility = repo?.private ? "Private" : "Public";
    return {
      ...repo,
      name,
      urlHref: url.href,
      urlText: url.text,
      visibility,
      topLanguagesText: topLanguages.length > 0 ? topLanguages.join(", ") : "No language data",
    };
  });

  return { repos };
}

async function getArchitecturesViewModel(req) {
  const developerId = await currentDeveloperId(req);
  const [rows, reposCount] = await Promise.all([
    prisma.developerArchitecture.findMany({
      where: { developerId },
      omit: omitIdDeveloperId,
      include: { architecture: { omit: omitId } },
      orderBy: { count: "desc" },
    }),
    prisma.repo.count({ where: { developerId } }),
  ]);

  return { rows, totalRepos: reposCount };
}

// -------------------------
// Monitoring view fragments
// -------------------------

async function getMonitoringRunsViewModel(req) {
  const jobType = req.query.type ? String(req.query.type) : undefined;
  const pageSize = PAGE_SIZE_TABLE;
  const pageRaw = parsePage(req.query[PAGINATION_PARAMS.monitoringRuns] ?? req.query.page);
  const total = await countJobRuns({ jobType });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageRaw, totalPages);
  const skip = (page - 1) * pageSize;
  const runs = await listJobRuns({ jobType, limit: pageSize, skip });
  return {
    runs: Array.isArray(runs) ? runs : [],
    pagination: {
      paramName: PAGINATION_PARAMS.monitoringRuns,
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

async function getMonitoringHealthViewModel() {
  const health = await healthSnapshot();
  return { health };
}

async function getMonitoringFailuresViewModel(req) {
  const pageSize = PAGE_SIZE_TABLE;
  const pageRaw = parsePage(req.query[PAGINATION_PARAMS.monitoringFailures] ?? req.query.page);
  const total = await countFailures();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageRaw, totalPages);
  const skip = (page - 1) * pageSize;
  const failures = await listFailures({ limit: pageSize, skip });
  return {
    failures: Array.isArray(failures) ? failures : [],
    pagination: {
      paramName: PAGINATION_PARAMS.monitoringFailures,
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

async function getMonitoringEventsViewModel(runId, req) {
  const rid = String(runId);
  const pageSize = PAGE_SIZE_TABLE;
  const pageRaw = parsePage(req.query[PAGINATION_PARAMS.monitoringEvents] ?? req.query.page);
  const total = await countJobEvents(rid);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageRaw, totalPages);
  const skip = (page - 1) * pageSize;
  const events = await getJobEvents(rid, { limit: pageSize, skip });
  return {
    runId: rid,
    events: Array.isArray(events) ? events : [],
    pagination: {
      paramName: PAGINATION_PARAMS.monitoringEvents,
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

module.exports = {
  getProfileViewModel,
  getExperienceViewModel,
  getEducationTabsViewModel,
  getSkillsTabsViewModel,
  getEndorsementsViewModel,
  getPortfolioTabsViewModel,
  getProjectsViewModel,
  getReposViewModel,
  getArchitecturesViewModel,
  getMonitoringRunsViewModel,
  getMonitoringHealthViewModel,
  getMonitoringFailuresViewModel,
  getMonitoringEventsViewModel,
};

