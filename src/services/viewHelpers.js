function columnLabel(key) {
  const raw = String(key ?? "").trim();
  if (!raw) return raw;
  const spaced = raw
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "id") return "ID";
      if (lower === "url") return "URL";
      if (lower === "api") return "API";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

/** Query param keys for per-tab pagination (portfolio, skills, endorsements, monitoring). */
const PAGINATION_PARAMS = {
  experience: "page",
  portfolioRepos: "reposPage",
  portfolioProjects: "projectsPage",
  skills: "skillsPage",
  developerTechStacks: "dtsPage",
  architectures: "archPage",
  endorsements: "endorsementsPage",
  recommendations: "recommendationsPage",
  monitoringRuns: "runsPage",
  monitoringFailures: "failuresPage",
};

function parsePage(raw, fallback = 1) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/**
 * @param {unknown[]} items
 * @param {{ page: number; pageSize: number }} opts
 */
function paginateArray(items, { page, pageSize }) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(pageSize) || 1));
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  let p = Math.max(1, Math.floor(Number(page) || 1));
  if (p > totalPages) p = totalPages;
  const start = (p - 1) * size;
  const slice = list.slice(start, start + size);
  return {
    slice,
    page: p,
    pageSize: size,
    total,
    totalPages,
  };
}

module.exports = {
  columnLabel,
  formatDateTime,
  PAGINATION_PARAMS,
  parsePage,
  paginateArray,
};

