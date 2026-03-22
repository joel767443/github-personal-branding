const prisma = require("../../db/prisma");
const { encryptField } = require("../../crypto/fieldEncryption");

/**
 * @param {number} developerId
 * @param {object} data
 * @param {string} data.twitterUserId
 * @param {string | null | undefined} data.twitterUsername
 * @param {string} data.accessTokenPlain
 * @param {string | null | undefined} data.refreshTokenPlain
 * @param {Date | null | undefined} data.accessTokenExpiresAt
 */
async function upsertTwitterAuth(developerId, data) {
  const accessTokenEnc = encryptField(data.accessTokenPlain);
  const refreshTokenEnc =
    data.refreshTokenPlain != null && String(data.refreshTokenPlain).trim()
      ? encryptField(String(data.refreshTokenPlain))
      : null;

  return prisma.developerTwitterAuthData.upsert({
    where: { developerId },
    create: {
      developerId,
      twitterUserId: String(data.twitterUserId),
      twitterUsername: data.twitterUsername != null ? String(data.twitterUsername) : null,
      accessTokenEnc,
      refreshTokenEnc,
      accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
    },
    update: {
      twitterUserId: String(data.twitterUserId),
      twitterUsername: data.twitterUsername != null ? String(data.twitterUsername) : null,
      accessTokenEnc,
      refreshTokenEnc,
      accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
    },
  });
}

/**
 * @param {number} developerId
 */
async function deleteTwitterAuth(developerId) {
  try {
    await prisma.developerTwitterAuthData.delete({
      where: { developerId },
    });
  } catch (e) {
    if (e && e.code === "P2025") return;
    throw e;
  }
}

/**
 * @param {number} developerId
 */
async function findTwitterAuthByDeveloperId(developerId) {
  return prisma.developerTwitterAuthData.findUnique({
    where: { developerId },
  });
}

module.exports = {
  upsertTwitterAuth,
  deleteTwitterAuth,
  findTwitterAuthByDeveloperId,
};
