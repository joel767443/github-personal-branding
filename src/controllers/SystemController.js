const { missingConfigKeys } = require("../config/runtimeConfig");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { healthSnapshot } = require("../services/monitoringService");
const prisma = require("../db/prisma");

class SystemController {
  async getStatus(req, res) {
    try {
      const missing = missingConfigKeys();
      const { developer, email } = await resolveDeveloperFromSession(req);
      const authenticated = Boolean(req.session?.user);
      
      let wizardStep = "completed";
      if (missing.length > 0) {
        wizardStep = "setup";
      } else if (!authenticated) {
        wizardStep = "login";
      } else if (!developer) {
        wizardStep = "sync";
      } else {
        const linkedinCount = await prisma.developerLinkedinSkill.count({ where: { developerId: developer.id } });
        if (linkedinCount === 0) {
          wizardStep = "upload";
        }
      }

      // If session has a forced wizardStep (e.g. from syncPipeline)
      if (req.session.wizardStep) {
        wizardStep = req.session.wizardStep;
      }

      const health = developer ? await healthSnapshot({ developerId: developer.id }) : null;
      
      const needsDeveloperCredentials = developer ? await this.checkNeedsCredentials(developer.id) : false;

      res.json({
        authenticated,
        user: req.session?.user ?? null,
        wizardStep,
        missing,
        needsDeveloperCredentials,
        linkedinCompleted: wizardStep === "completed",
        linkedinImportInProgress: health?.lastLinkedin?.status === "running",
        syncInProgress: health?.lastSync?.status === "running",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async checkNeedsCredentials(developerId) {
    const dev = await prisma.developer.findUnique({
      where: { id: developerId },
      select: { githubPatEnc: true, githubOauthClientSecretEnc: true }
    });
    // If we have a global GITHUB_TOKEN, we might not "need" them, but usually this flag 
    // triggers the PAT entry card.
    return !dev?.githubPatEnc && !process.env.GITHUB_TOKEN;
  }
}

module.exports = new SystemController();
