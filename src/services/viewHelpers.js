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

/** Renders as `2023/02/24 07:19:19 UTC` (fixed offset, easy to scan). */
function formatDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}/${mo}/${day} ${h}:${min}:${s} UTC`;
}

/**
 * Used by generic `_dataTable`: format Date / ISO strings; keep other objects as JSON.
 */
function formatDataTableCell(value) {
  if (value == null) return { kind: "empty" };
  if (value instanceof Date) return { kind: "text", text: formatDateTime(value) };
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(t) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t)) {
      const parsed = new Date(t);
      if (!Number.isNaN(parsed.getTime())) return { kind: "text", text: formatDateTime(t) };
    }
    return { kind: "text", text: value };
  }
  if (typeof value === "object") return { kind: "json", value };
  return { kind: "text", text: String(value) };
}

/** Pretty-print JSON or primitives for read-only display (events payload, etc.). */
function formatJson(value) {
  if (value == null || value === undefined) return "—";
  try {
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  } catch {
    return String(value);
  }
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
  monitoringEvents: "eventsPage",
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
  formatDataTableCell,
  formatJson,
  PAGINATION_PARAMS,
  parsePage,
  paginateArray,
};

