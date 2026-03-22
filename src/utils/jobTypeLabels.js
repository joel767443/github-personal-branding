/**
 * Human-readable job labels for monitoring UI and dashboard charts.
 * @param {string | null | undefined} jobType
 * @param {unknown} metadata JobRun.metadata (may include `platform` for social_media).
 */
function formatJobTypeLabel(jobType, metadata) {
  const jt = String(jobType ?? "").trim();
  let platform = null;
  if (metadata && typeof metadata === "object" && metadata !== null && "platform" in metadata) {
    const p = /** @type {{ platform?: unknown }} */ (metadata).platform;
    if (typeof p === "string" && p.trim()) platform = p.trim().toLowerCase();
  }
  switch (jt) {
    case "sync":
      return "GitHub sync";
    case "linkedin":
      return "LinkedIn import";
    case "social_media":
      if (platform === "facebook") return "Social post (Facebook)";
      if (platform === "twitter") return "Social post (X)";
      if (platform === "linkedin") return "Social post (LinkedIn)";
      return "Social post";
    default:
      return jt || "Job";
  }
}

module.exports = {
  formatJobTypeLabel,
};
