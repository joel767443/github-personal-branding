/**
 * Placeholder for X (Twitter) API v2 post body.
 * Wire credentials and `toApiBody()` when Twitter OAuth/tokens exist in the app.
 */
class TwitterPostPayload {
  /**
   * @param {object} opts
   * @param {string} [opts.text]
   */
  constructor(opts = {}) {
    this.text = opts.text == null ? '' : String(opts.text);
  }

  /** @returns {Record<string, unknown>} */
  toApiBody() {
    throw new Error('TwitterPostPayload: posting not implemented');
  }
}

module.exports = { TwitterPostPayload };
