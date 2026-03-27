const axios = require("axios");
const prisma = require("../db/prisma");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { respondError } = require("../utils/httpErrors");
const { sanitizeDeveloperForClient } = require("../services/DataNormalizationService");
const { encryptField } = require("../crypto/fieldEncryption");
const { parseSyncFrequency } = require("../services/syncFrequencyHelpers");

class SettingsController {
  async getSettings(req, res) {
    try {
      const { developer } = await resolveDeveloperFromSession(req);
      if (!developer) return respondError(res, 404, "No developer record", "Profile not found");
      const full = await prisma.developer.findUnique({
        where: { id: developer.id },
        include: {
          socialIntegrations: { orderBy: { platform: "asc" } },
          developerFacebookAuthData: true,
          developerTwitterAuthData: true,
        },
      });
      res.json({ ok: true, developer: sanitizeDeveloperForClient(full) });
    } catch (err) {
      respondError(res, 500, "Settings load failed", err?.message);
    }
  }

  async updateSettings(req, res) {
    try {
      const { developer } = await resolveDeveloperFromSession(req);
      if (!developer) return respondError(res, 404, "No developer record", "Profile not found");
      
      const body = req.body ?? {};
      const data = {};
      
      if (body.syncFrequency) data.syncFrequency = parseSyncFrequency(body.syncFrequency);
      if (body.deployRepoUrl !== undefined) data.deployRepoUrl = body.deployRepoUrl || null;
      
      if (body.githubOauthClientId !== undefined) {
        data.githubOauthClientId = String(body.githubOauthClientId || "").trim() || null;
      }
      if (body.clearGithubOauthClientSecret) {
        data.githubOauthClientSecretEnc = null;
      } else if (body.githubOauthClientSecret) {
        data.githubOauthClientSecretEnc = encryptField(body.githubOauthClientSecret);
      }

      if (body.accessToken) data.linkedinAccessTokenEnc = encryptField(body.accessToken);
      if (body.personId !== undefined) data.linkedinPersonId = body.personId || null;
      
      if (body.githubPat) {
        const validated = await this.validateGithubPat(body.githubPat);
        if (!validated.ok) return respondError(res, 400, "Invalid GitHub token", validated.details);
        data.githubPatEnc = encryptField(body.githubPat);
      }

      if (Object.keys(data).length) {
        await prisma.developer.update({ where: { id: developer.id }, data });
      }

      if (body.socialIntegrations) {
        for (const [key, enabled] of Object.entries(body.socialIntegrations)) {
          const platform = key.toUpperCase();
          if (!["FACEBOOK", "TWITTER", "LINKEDIN"].includes(platform)) continue;
          await prisma.developerSocialIntegration.upsert({
            where: { developerId_platform: { developerId: developer.id, platform } },
            create: { developerId: developer.id, platform, enabled: Boolean(enabled) },
            update: { enabled: Boolean(enabled) },
          });
        }
      }

      const full = await prisma.developer.findUnique({
        where: { id: developer.id },
        include: { socialIntegrations: true, developerFacebookAuthData: true, developerTwitterAuthData: true },
      });
      res.json({ ok: true, developer: sanitizeDeveloperForClient(full) });
    } catch (err) {
      respondError(res, 500, "Settings update failed", err?.message);
    }
  }

  async validateGithubPat(token) {
    try {
      const resp = await axios.get("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (resp.status === 200) return { ok: true };
      return { ok: false, details: "Token validation failed" };
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || "Could not verify token";
      return { ok: false, details: msg };
    }
  }
}

module.exports = new SettingsController();
