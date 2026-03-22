/**
 * Payload for LinkedIn `POST /rest/posts` (does not include `author`; caller adds URN from `linkedin_person_id`).
 * @see https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/posts-api
 */

class LinkedInPostPayload {
  /**
   * @param {object} opts
   * @param {string} [opts.text] Post body (`commentary`).
   */
  constructor(opts = {}) {
    this.text = opts.text == null ? '' : String(opts.text);
    this.validate();
  }

  validate() {
    const t = this.text.trim();
    if (!t) {
      throw new Error('LinkedInPostPayload: text is required');
    }
  }

  /** Fields for `/rest/posts` excluding `author`. */
  toApiBody() {
    return {
      commentary: this.text.trim(),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
  }
}

module.exports = { LinkedInPostPayload };
