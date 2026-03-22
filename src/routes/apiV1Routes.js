const express = require("express");
const prisma = require("../db/prisma");
const requireLogin = require("../middleware/requireLogin");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { respondError } = require("../utils/httpErrors");
const { commitApiOmit } = require("../constants/apiResponseOmit");
const {
  developerDetailInclude,
  developerIntelligenceInclude,
} = require("../constants/developerApiIncludes");
const { safeJson } = require("../utils/prismaJson");
const { stripDeveloperSecretsDeep } = require("../utils/developerApiSanitize");
const detectTechStacks = require("../jobs/detectTechStacks");
const detectDeveloperArchitectures = require("../jobs/detectDeveloperArchitectures");
const { assertCanRunPaidJobs } = require("../services/subscriptionAccess");
const { clientSafeUpstreamDetails } = require("../utils/safeClientError");

const router = express.Router();

const DEVELOPER_OMIT = {
  linkedinAccessTokenEnc: true,
  githubPatEnc: true,
  githubOauthClientSecretEnc: true,
};

function parseLimitOffset(req) {
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit = limitRaw === undefined ? 50 : Number(limitRaw);
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);

  if (!Number.isInteger(limit) || limit < 0) return { error: "Invalid `limit`" };
  if (!Number.isInteger(offset) || offset < 0) return { error: "Invalid `offset`" };

  return { limit: Math.min(limit, 200), offset };
}

async function requireDeveloperRecord(req, res) {
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

router.use(requireLogin);

router.get("/me/developer", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  try {
    const developer = await prisma.developer.findUnique({
      where: { id: developerId },
      omit: DEVELOPER_OMIT,
      include: developerDetailInclude,
    });
    if (!developer) return respondError(res, 404, "Not found", { id: developerId });
    res.json(stripDeveloperSecretsDeep(developer));
  } catch (err) {
    respondError(res, 500, "Failed to fetch developer", err?.message ?? String(err));
  }
});

router.get("/me/repos", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  try {
    const repos = await prisma.repo.findMany({
      where: { developerId },
      include: {
        commits: { omit: commitApiOmit },
        languages: true,
        repoTechStacks: { orderBy: { score: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(safeJson(repos));
  } catch (err) {
    respondError(res, 500, "Failed to fetch repositories", err?.message ?? String(err));
  }
});

router.get("/me/repos/:repoId", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  const repoId = String(req.params.repoId ?? "").trim();
  if (!repoId) return respondError(res, 400, "Invalid parameter", { param: "repoId" });
  try {
    const repo = await prisma.repo.findFirst({
      where: { id: repoId, developerId },
      include: {
        commits: { omit: commitApiOmit },
        languages: true,
        repoTechStacks: { orderBy: { score: "desc" } },
        developer: { include: developerIntelligenceInclude },
      },
    });
    if (!repo) return respondError(res, 404, "Not found", { repoId });
    res.json(safeJson(stripDeveloperSecretsDeep(repo)));
  } catch (err) {
    respondError(res, 500, "Failed to fetch repository", err?.message ?? String(err));
  }
});

router.get("/me/tech-stacks", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  try {
    const techStacks = await prisma.developerTechStack.findMany({
      where: { developerId },
      orderBy: { percentage: "desc" },
    });
    res.json(techStacks);
  } catch (err) {
    respondError(res, 500, "Failed to fetch tech stacks", err?.message ?? String(err));
  }
});

router.get("/me/developer-architectures", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  try {
    const rows = await prisma.developerArchitecture.findMany({
      where: { developerId },
      include: { architecture: true },
      orderBy: { count: "desc" },
    });
    res.json(rows);
  } catch (err) {
    respondError(res, 500, "Failed to fetch developer architectures", err?.message ?? String(err));
  }
});

router.get("/catalog/architectures", async (req, res) => {
  try {
    const parsed = parseLimitOffset(req);
    if (parsed.error) {
      return respondError(res, 400, "Invalid query parameters", { details: parsed.error });
    }
    const architectures = await prisma.architecture.findMany({
      take: parsed.limit,
      skip: parsed.offset,
      orderBy: { count: "desc" },
    });
    res.json(architectures);
  } catch (err) {
    respondError(res, 500, "Failed to fetch architecture catalog", err?.message ?? String(err));
  }
});

router.get("/catalog/architectures/:name", async (req, res) => {
  const name = String(req.params.name ?? "").trim();
  if (!name) return respondError(res, 400, "Invalid parameter", { param: "name" });
  try {
    const architecture = await prisma.architecture.findUnique({
      where: { name },
    });
    if (!architecture) return respondError(res, 404, "Not found", { name });
    res.json(architecture);
  } catch (err) {
    respondError(res, 500, "Failed to fetch architecture", err?.message ?? String(err));
  }
});

router.get("/tech-detector-rules", async (req, res) => {
  try {
    const rules = await prisma.techDetectorRule.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(rules);
  } catch (err) {
    respondError(res, 500, "Failed to fetch tech detector rules", err?.message ?? String(err));
  }
});

router.post("/me/actions/detect-tech-stacks", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  try {
    await assertCanRunPaidJobs(developerId);
    await detectTechStacks({ developerId });
    res.status(202).json({ status: "accepted", message: "Tech stack detection completed for your account" });
  } catch (err) {
    const code = err?.code;
    if (code === "SUBSCRIPTION_REQUIRED") {
      return respondError(res, 402, "Subscription required", err?.message ?? String(err));
    }
    const status = err?.response?.status ?? 500;
    const details = clientSafeUpstreamDetails(err, "Tech stack detection failed");
    respondError(res, status, "Tech stack detection failed", details);
  }
});

router.post("/me/actions/detect-architectures", async (req, res) => {
  const developerId = await requireDeveloperRecord(req, res);
  if (developerId == null) return;
  try {
    await assertCanRunPaidJobs(developerId);
    const branch =
      req.body && typeof req.body.branch === "string" && req.body.branch.trim()
        ? String(req.body.branch).trim()
        : "main";
    await detectDeveloperArchitectures({ branch, developerId });
    res
      .status(202)
      .json({ status: "accepted", message: "Architecture detection completed for your account" });
  } catch (err) {
    const code = err?.code;
    if (code === "SUBSCRIPTION_REQUIRED") {
      return respondError(res, 402, "Subscription required", err?.message ?? String(err));
    }
    const status = err?.response?.status ?? 500;
    const details = clientSafeUpstreamDetails(err, "Architecture detection failed");
    respondError(res, status, "Architecture detection failed", details);
  }
});

module.exports = router;
