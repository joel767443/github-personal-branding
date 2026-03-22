/**
 * X API v2 `POST /2/tweets` JSON body.
 */
class TwitterPostPayload {
  /**
   * @param {object} opts
   * @param {string} [opts.text]
   */
  constructor(opts = {}) {
    this.text = opts.text == null ? "" : String(opts.text);
  }

  /** @returns {{ text: string }} */
  toApiBody() {
    return { text: this.text };
  }
}

module.exports = { TwitterPostPayload };
