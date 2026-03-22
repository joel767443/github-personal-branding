/**
 * Avoid returning raw upstream errors or internal messages to HTTP clients in production.
 */

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/** @param {unknown} err */
function clientSafeMessage(err, fallback = "An unexpected error occurred") {
  if (isProduction()) return fallback;
  return err?.message != null ? String(err.message) : String(err);
}

/**
 * Safe `details` for JSON error bodies (not raw axios `response.data` in production).
 * @param {unknown} err
 */
function clientSafeUpstreamDetails(err, fallback = "Request failed") {
  if (isProduction()) return fallback;
  return err?.response?.data ?? err?.message ?? String(err);
}

/**
 * GitHub OAuth token endpoint JSON — never forward the full object (defensive).
 * @param {Record<string, unknown>} tokenJson
 */
function githubOAuthTokenErrorForClient(tokenJson) {
  const t = tokenJson && typeof tokenJson === "object" ? tokenJson : {};
  return {
    error: t.error != null ? String(t.error) : undefined,
    error_description: t.error_description != null ? String(t.error_description) : undefined,
    error_uri: t.error_uri != null ? String(t.error_uri) : undefined,
  };
}

/** @param {unknown} details */
function sanitizeJobFailureDetails(details) {
  if (details == null) return null;
  if (isProduction()) return null;
  try {
    const s = typeof details === "string" ? details : JSON.stringify(details);
    return s.length > 800 ? `${s.slice(0, 800)}…` : s;
  } catch {
    return null;
  }
}

/** @param {unknown} stack */
function sanitizeJobFailureStack(stack) {
  if (stack == null) return null;
  if (isProduction()) return null;
  return String(stack);
}

module.exports = {
  isProduction,
  clientSafeMessage,
  clientSafeUpstreamDetails,
  githubOAuthTokenErrorForClient,
  sanitizeJobFailureDetails,
  sanitizeJobFailureStack,
};
