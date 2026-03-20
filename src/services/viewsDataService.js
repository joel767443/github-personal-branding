const prisma = require("../db/prisma");
const { resolveDeveloperFromSession } = require("./sessionDeveloperService");
const { endorsementApiOmit } = require("../constants/apiResponseOmit");
const {
  listJobRuns,
  getJobEvents,
  listFailures,
  healthSnapshot,
} = require("./monitoringService");

const omitId = { id: true };
const omitIdDeveloperId = { id: true, developerId: true };
const omitIdDeveloperSort = { id: true, developerId: true, sortOrder: true };

function safeJson(value) {
  // Prisma can return BigInt in some cases; normalize to string so EJS can render.
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

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
  return {
    rows: sorted.map((r) => ({
      title: r?.title ?? "",
      company: r?.company ?? "",
      dates: r?.dates ?? "",
      location: r?.location ?? "",
      description: r?.description ?? "",
    })),
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

  const [skills, developerTechStacks, architectures, reposCount] = await Promise.all([
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

  return {
    activeTab: initialTab,
    skills,
    developerTechStacks,
    architectures,
    overview: { repos: reposCount },
  };
}

async function getEndorsementsTabsViewModel(req, activeTab) {
  const developerId = await currentDeveloperId(req);
  const allowedTabs = new Set(["endorsements", "recommendations"]);
  const initialTab = normalizeActiveTab(activeTab, allowedTabs, "endorsements");

  const [endorsements, recommendations] = await Promise.all([
    prisma.developerLinkedinReceivedEndorsement.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      omit: { ...omitIdDeveloperSort, ...endorsementApiOmit },
    }),
    prisma.developerRecommendation.findMany({
      where: { developerId },
      orderBy: { sortOrder: "asc" },
      omit: omitIdDeveloperSort,
    }),
  ]);

  return { activeTab: initialTab, endorsements, recommendations };
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

  return { activeTab: initialTab, repos, projects };
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

async function getMonitoringRunsViewModel(req, { limit }) {
  const runs = await listJobRuns({ limit, jobType: req.query.type ? String(req.query.type) : undefined });
  return { runs: Array.isArray(runs) ? runs : [] };
}

async function getMonitoringHealthViewModel() {
  const health = await healthSnapshot();
  return { health };
}

async function getMonitoringFailuresViewModel({ limit }) {
  const failures = await listFailures({ limit });
  return { failures: Array.isArray(failures) ? failures : [] };
}

async function getMonitoringEventsViewModel(runId, { limit }) {
  const events = await getJobEvents(String(runId), { limit });
  return { events: Array.isArray(events) ? events : [] };
}

module.exports = {
  getProfileViewModel,
  getExperienceViewModel,
  getEducationTabsViewModel,
  getSkillsTabsViewModel,
  getEndorsementsTabsViewModel,
  getPortfolioTabsViewModel,
  getProjectsViewModel,
  getReposViewModel,
  getArchitecturesViewModel,
  getMonitoringRunsViewModel,
  getMonitoringHealthViewModel,
  getMonitoringFailuresViewModel,
  getMonitoringEventsViewModel,
};

