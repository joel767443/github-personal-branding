/** Omit primary keys (and owning developer FK) from JSON for dashboard /data views. */
const omitId = { id: true };
const omitIdDeveloperId = { id: true, developerId: true };
/** Models with a `sortOrder` column (omit it from JSON; `orderBy` still works in queries). */
const omitIdDeveloperSort = { id: true, developerId: true, sortOrder: true };

/**
 * Prisma can return BigInt in some cases; normalize to string so JSON/EJS can render.
 * @param {unknown} value
 */
function safeJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

module.exports = {
  omitId,
  omitIdDeveloperId,
  omitIdDeveloperSort,
  safeJson,
};
