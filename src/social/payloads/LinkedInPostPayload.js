/**
 * Placeholder for LinkedIn UGC / share API payload.
 * Wire `linkedinAccessTokenEnc` and REST calls when implementing.
 */
class LinkedInPostPayload {
  /**
   * @param {object} opts
   * @param {string} [opts.text]
   */
  constructor(opts = {}) {
    this.text = opts.text == null ? '' : String(opts.text);
  }

  /** @returns {Record<string, unknown>} */
  toApiBody() {
    throw new Error('LinkedInPostPayload: posting not implemented');
  }
}

module.exports = { LinkedInPostPayload };
