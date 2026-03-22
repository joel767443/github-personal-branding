/** Max length for Page feed message text (Graph API). */
const MAX_MESSAGE_LENGTH = 63206;

/**
 * Payload for `POST /{page-id}/feed` (does not include `access_token`; caller adds it).
 * @see https://developers.facebook.com/docs/graph-api/reference/page/feed#Creating
 */
class FacebookPostPayload {
  /**
   * @param {object} opts
   * @param {string} opts.message Primary text body (required).
   * @param {string} [opts.link] Optional URL for a link post.
   * @param {boolean} [opts.published] Default true.
   * @param {number} [opts.scheduledPublishTime] Unix seconds for scheduled posts.
   */
  constructor(opts = {}) {
    const { message, link, published, scheduledPublishTime } = opts;
    this.message = message == null ? '' : String(message);
    this.link = link == null || link === '' ? null : String(link).trim();
    this.published = published === undefined ? true : Boolean(published);
    this.scheduledPublishTime =
      scheduledPublishTime == null ? null : Number(scheduledPublishTime);
    this.validate();
  }

  validate() {
    const msg = this.message.trim();
    if (!msg) {
      throw new Error('FacebookPostPayload: message is required');
    }
    if (msg.length > MAX_MESSAGE_LENGTH) {
      throw new Error(
        `FacebookPostPayload: message exceeds ${MAX_MESSAGE_LENGTH} characters`,
      );
    }
    if (this.link) {
      let u;
      try {
        u = new URL(this.link);
      } catch {
        throw new Error('FacebookPostPayload: link must be a valid URL');
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('FacebookPostPayload: link must be http or https');
      }
    }
    if (
      this.scheduledPublishTime != null &&
      (Number.isNaN(this.scheduledPublishTime) || this.scheduledPublishTime < 0)
    ) {
      throw new Error('FacebookPostPayload: scheduledPublishTime must be a non-negative number');
    }
  }

  /**
   * Fields for Graph `/{page-id}/feed` (excluding `access_token`).
   * @returns {Record<string, string>}
   */
  toFeedFormFields() {
    /** @type {Record<string, string>} */
    const fields = {
      message: this.message.trim(),
    };
    if (this.link) {
      fields.link = this.link;
    }
    if (this.published === false) {
      fields.published = 'false';
    }
    if (this.scheduledPublishTime != null) {
      fields.scheduled_publish_time = String(Math.floor(this.scheduledPublishTime));
    }
    return fields;
  }
}

module.exports = {
  FacebookPostPayload,
  MAX_MESSAGE_LENGTH,
};
