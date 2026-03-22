const express = require("express");
const requireLogin = require("../middleware/requireLogin");
const {
  listJobRuns,
  getJobEvents,
  listFailures,
  healthSnapshot,
} = require("../services/monitoringService");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const { respondError } = require("../utils/httpErrors");

const router = express.Router();

router.get("/monitoring/runs", requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    const developerId = developer?.id ?? null;
    if (developerId == null) {
      return res.json([]);
    }
    const runs = await listJobRuns({
      jobType: req.query.type ? String(req.query.type) : undefined,
      limit: req.query.limit,
      developerId,
    });
    res.json(runs);
  } catch (err) {
    respondError(res, 500, "Failed to fetch monitoring runs", err?.message ?? String(err));
  }
});

router.get("/monitoring/runs/:runId/events", requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    const developerId = developer?.id ?? null;
    if (developerId == null) {
      return respondError(res, 403, "Forbidden", "No developer profile for this session");
    }
    const events = await getJobEvents(String(req.params.runId), {
      limit: req.query.limit,
      skip: req.query.skip,
      developerId,
    });
    if (events === null) {
      return respondError(res, 403, "Forbidden", "This job run does not belong to your account");
    }
    res.json(events);
  } catch (err) {
    respondError(res, 500, "Failed to fetch run events", err?.message ?? String(err));
  }
});

router.get("/monitoring/failures", requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    const developerId = developer?.id ?? null;
    if (developerId == null) {
      return res.json([]);
    }
    const failures = await listFailures({ limit: req.query.limit, developerId });
    res.json(failures);
  } catch (err) {
    respondError(res, 500, "Failed to fetch failures", err?.message ?? String(err));
  }
});

router.get("/monitoring/health", requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    const developerId = developer?.id ?? null;
    if (developerId == null) {
      return res.json({
        lastSync: null,
        lastLinkedin: null,
        failures24h: 0,
        runningJobs: 0,
      });
    }
    const health = await healthSnapshot({ developerId });
    res.json(health);
  } catch (err) {
    respondError(res, 500, "Failed to fetch health", err?.message ?? String(err));
  }
});

module.exports = router;
