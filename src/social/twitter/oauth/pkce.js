const crypto = require("crypto");

/** @returns {string} URL-safe verifier (43–128 chars per RFC 7636). */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * S256 code challenge for PKCE.
 * @param {string} codeVerifier
 * @returns {string}
 */
function generateCodeChallenge(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
};
