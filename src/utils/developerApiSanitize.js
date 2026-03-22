/**
 * Remove credential material from Developer-shaped objects for JSON responses.
 * @param {Record<string, unknown> | null | undefined} dev
 */
function sanitizeDeveloperForClient(dev) {
  if (!dev || typeof dev !== "object") return dev;
  const {
    githubOauthClientSecretEnc,
    githubPatEnc,
    linkedinAccessTokenEnc,
    ...rest
  } = dev;
  return {
    ...rest,
    githubOauthClientSecretConfigured: Boolean(githubOauthClientSecretEnc),
    githubPatConfigured: Boolean(githubPatEnc),
    linkedinAccessTokenConfigured: Boolean(linkedinAccessTokenEnc),
  };
}

/**
 * Remove `*Enc` fields recursively (e.g. nested `repo.developer`).
 * @param {unknown} value
 */
function stripDeveloperSecretsDeep(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(stripDeveloperSecretsDeep);
  if (typeof value !== "object") return value;
  /** @type {Record<string, unknown>} */
  const obj = /** @type {Record<string, unknown>} */ (value);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.endsWith("Enc")) continue;
    out[k] = stripDeveloperSecretsDeep(v);
  }
  return out;
}

module.exports = {
  sanitizeDeveloperForClient,
  stripDeveloperSecretsDeep,
};
