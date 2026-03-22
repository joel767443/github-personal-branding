const prisma = require("../db/prisma");
const { TwitterPostPayload } = require("../social/payloads/TwitterPostPayload");
const { getDecryptedAccessTokenForDeveloper } = require("../social/twitter/twitterTokenService");
const { createTweet } = require("../social/twitter/twitterApiClient");

/**
 * @param {number} developerId
 * @param {TwitterPostPayload | Record<string, unknown>} payload
 */
async function postTwitter(developerId, payload) {
  const tw =
    payload instanceof TwitterPostPayload ? payload : new TwitterPostPayload(payload);
  const body = tw.toApiBody();
  const accessToken = await getDecryptedAccessTokenForDeveloper(developerId);
  const result = await createTweet(accessToken, body);
  await prisma.developerTwitterAuthData.update({
    where: { developerId },
    data: { lastPostedAt: new Date() },
  });
  return { platform: "twitter", postId: result.id, success: true };
}

module.exports = { postTwitter };
