class DataNormalizationService {
  constructor() {
    this.omitId = { id: true };
    this.omitIdDeveloperId = { id: true, developerId: true };
    this.omitIdDeveloperSort = { id: true, developerId: true, sortOrder: true };
  }

  /**
   * Prisma can return BigInt in some cases; normalize to string so JSON/EJS can render.
   */
  safeJson = (value) => {
    return JSON.parse(
      JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))
    );
  };

  /**
   * Remove sensitive fields and normalize developer data for client consumption.
   */
  sanitizeDeveloperForClient = (developer) => {
    if (!developer) return null;
    const {
      linkedinAccessTokenEnc,
      githubOauthClientSecretEnc,
      githubPatEnc,
      ...safe
    } = developer;

    return {
      ...this.safeJson(safe),
      linkedinConfigured: Boolean(linkedinAccessTokenEnc),
      githubOauthConfigured: Boolean(githubOauthClientSecretEnc),
      githubPatConfigured: Boolean(githubPatEnc),
    };
  };

  /**
   * Deeply remove sensitive fields from objects (used in API routes).
   */
  stripDeveloperSecretsDeep = (data) => {
    if (!data) return data;
    if (Array.isArray(data)) return data.map(d => this.stripDeveloperSecretsDeep(d));
    if (typeof data !== "object") return data;

    const {
      linkedinAccessTokenEnc,
      githubOauthClientSecretEnc,
      githubPatEnc,
      ...rest
    } = data;

    const result = { ...rest };
    for (const key in result) {
      if (result[key] && typeof result[key] === "object") {
        result[key] = this.stripDeveloperSecretsDeep(result[key]);
      }
    }
    return result;
  };
}

module.exports = new DataNormalizationService();
