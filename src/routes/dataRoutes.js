const express = require("express");
const prisma = require("../db/prisma");
const requireLogin = require("../middleware/requireLogin");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { respondError } = require("../utils/httpErrors");
const { endorsementApiOmit } = require("../constants/apiResponseOmit");
const {
  omitId,
  omitIdDeveloperId,
  omitIdDeveloperSort,
  safeJson,
} = require("../utils/prismaJson");
const { sanitizeDeveloperForClient } = require("../utils/developerApiSanitize");

const router = express.Router();

async function currentDeveloperId(req, res) {
  const resolved = await resolveDeveloperFromSession(req);
  if (!resolved.email) {
    respondError(res, 400, "Missing profile email", "Unable to derive email from session");
    return null;
  }
  if (!resolved.developer) {
    respondError(res, 404, "No developer record", "Run GitHub sync first");
    return null;
  }
  return resolved.developer.id;
}

router.get("/data/overview", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;
  try {
    const [
      experiences,
      education,
      certifications,
      projects,
      skills,
      endorsements,
      recommendations,
      publications,
      repos,
    ] = await Promise.all([
      prisma.developerExperience.count({ where: { developerId } }),
      prisma.education.count({ where: { developerId } }),
      prisma.certification.count({ where: { developerId } }),
      prisma.project.count({ where: { developerId } }),
      prisma.developerLinkedinSkill.count({ where: { developerId } }),
      prisma.developerLinkedinReceivedEndorsement.count({ where: { developerId } }),
      prisma.developerRecommendation.count({ where: { developerId } }),
      prisma.developerPublication.count({ where: { developerId } }),
      prisma.repo.count({ where: { developerId } }),
    ]);
    res.json({
      experiences,
      education,
      certifications,
      projects,
      skills,
      endorsements,
      recommendations,
      publications,
      repos,
    });
  } catch (err) {
    respondError(res, 500, "Failed to fetch data overview", err?.message ?? String(err));
  }
});

router.get("/data/profile", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;
  try {
    const developer = await prisma.developer.findUnique({
      where: { id: developerId },
      include: {
        developerFacebookAuthData: true,
        developerTwitterAuthData: true,
      },
    });
    if (!developer) {
      return respondError(res, 404, "No developer record", "Run GitHub sync first");
    }
    res.json(sanitizeDeveloperForClient(developer));
  } catch (err) {
    respondError(res, 500, "Failed to fetch profile data", err?.message ?? String(err));
  }
});

function listRoute(
  path,
  delegate,
  whereBuilder = (developerId) => ({ developerId }),
  orderBy = { sortOrder: "asc" },
  findManyExtras = {},
) {
  router.get(path, requireLogin, async (req, res) => {
    const developerId = await currentDeveloperId(req, res);
    if (developerId == null) return;
    try {
      const rows = await delegate.findMany({
        where: whereBuilder(developerId),
        orderBy,
        ...findManyExtras,
      });
      res.json(rows);
    } catch (err) {
      respondError(res, 500, `Failed to fetch ${path} data`, err?.message ?? String(err));
    }
  });
}

listRoute("/data/experience", prisma.developerExperience, undefined, undefined, {
  omit: omitIdDeveloperSort,
});

router.get("/data/education", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;

  try {
    const [education, certifications, publications] = await Promise.all([
      prisma.education.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: omitIdDeveloperSort,
      }),
      prisma.certification.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: omitIdDeveloperSort,
      }),
      prisma.developerPublication.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: omitIdDeveloperSort,
      }),
    ]);

    res.json({
      education,
      certifications,
      publications,
    });
  } catch (err) {
    respondError(res, 500, "Failed to fetch education data", err?.message ?? String(err));
  }
});

router.get("/data/portfolio", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;

  try {
    const [repos, projects] = await Promise.all([
      prisma.repo.findMany({
        where: { developerId },
        omit: omitIdDeveloperId,
        include: {
          languages: { omit: omitId },
          repoTechStacks: { omit: omitId, orderBy: { score: "desc" } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.project.findMany({
        where: { developerId },
        omit: omitIdDeveloperSort,
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    res.json({
      repos: safeJson(repos),
      projects,
    });
  } catch (err) {
    respondError(res, 500, "Failed to fetch portfolio data", err?.message ?? String(err));
  }
});

listRoute("/data/developer-tech-stacks", prisma.developerTechStack, (developerId) => ({ developerId }), { percentage: "desc" }, {
  omit: omitIdDeveloperId,
});

router.get("/data/endorsements", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;

  try {
    const [endorsements, recommendations] = await Promise.all([
      prisma.developerLinkedinReceivedEndorsement.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: { ...omitIdDeveloperSort, ...endorsementApiOmit },
      }),
      prisma.developerRecommendation.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: omitIdDeveloperSort,
      }),
    ]);

    res.json({
      endorsements,
      recommendations,
    });
  } catch (err) {
    respondError(res, 500, "Failed to fetch endorsements data", err?.message ?? String(err));
  }
});

// Back-compat: keep the old URL, but serve the same consolidated payload.
router.get("/data/recommendations", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;

  try {
    const [endorsements, recommendations] = await Promise.all([
      prisma.developerLinkedinReceivedEndorsement.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: { ...omitIdDeveloperSort, ...endorsementApiOmit },
      }),
      prisma.developerRecommendation.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: omitIdDeveloperSort,
      }),
    ]);

    res.json({
      endorsements,
      recommendations,
    });
  } catch (err) {
    respondError(res, 500, "Failed to fetch recommendations data", err?.message ?? String(err));
  }
});

router.get("/data/skills", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;

  try {
    const [skills, developerTechStacks, architectures, reposCount] = await Promise.all([
      prisma.developerLinkedinSkill.findMany({
        where: { developerId },
        orderBy: { sortOrder: "asc" },
        omit: omitIdDeveloperSort,
      }),
      prisma.developerTechStack.findMany({
        where: { developerId },
        orderBy: { percentage: "desc" },
        omit: omitIdDeveloperId,
      }),
      prisma.developerArchitecture.findMany({
        where: { developerId },
        omit: omitIdDeveloperId,
        include: { architecture: { omit: omitId } },
        orderBy: { count: "desc" },
      }),
      prisma.repo.count({ where: { developerId } }),
    ]);

    res.json({
      skills,
      developerTechStacks,
      architectures,
      overview: { repos: reposCount },
    });
  } catch (err) {
    respondError(res, 500, "Failed to fetch skills data", err?.message ?? String(err));
  }
});

router.get("/data/architectures", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;
  try {
    const rows = await prisma.developerArchitecture.findMany({
      where: { developerId },
      omit: omitIdDeveloperId,
      include: { architecture: { omit: omitId } },
      orderBy: { count: "desc" },
    });
    res.json(rows);
  } catch (err) {
    respondError(res, 500, "Failed to fetch architectures data", err?.message ?? String(err));
  }
});

router.get("/data/repos", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;
  try {
    const rows = await prisma.repo.findMany({
      where: { developerId },
      omit: omitIdDeveloperId,
      include: {
        languages: { omit: omitId },
        repoTechStacks: { omit: omitId, orderBy: { score: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(safeJson(rows));
  } catch (err) {
    respondError(res, 500, "Failed to fetch repos data", err?.message ?? String(err));
  }
});

router.get("/data/projects", requireLogin, async (req, res) => {
  const developerId = await currentDeveloperId(req, res);
  if (developerId == null) return;
  try {
    const rows = await prisma.project.findMany({
      where: { developerId },
      omit: omitIdDeveloperSort,
      orderBy: { sortOrder: "asc" },
    });
    res.json(rows);
  } catch (err) {
    respondError(res, 500, "Failed to fetch projects data", err?.message ?? String(err));
  }
});

module.exports = router;
