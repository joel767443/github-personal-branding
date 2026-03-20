const express = require("express");
const requireLogin = require("../middleware/requireLogin");
const {
  listJobRuns,
  getJobEvents,
  listFailures,
  healthSnapshot,
} = require("../services/monitoringService");
const { respondError } = require("../utils/httpErrors");

const router = express.Router();

router.get("/monitoring/runs", requireLogin, async (req, res) => {
  try {
    const runs = await listJobRuns({
      jobType: req.query.type ? String(req.query.type) : undefined,
      limit: req.query.limit,
    });
    res.json(runs);
  } catch (err) {
    respondError(res, 500, "Failed to fetch monitoring runs", err?.message ?? String(err));
  }
});

router.get("/monitoring/runs/:runId/events", requireLogin, async (req, res) => {
  try {
    const events = await getJobEvents(String(req.params.runId), { limit: req.query.limit });
    res.json(events);
  } catch (err) {
    respondError(res, 500, "Failed to fetch run events", err?.message ?? String(err));
  }
});

router.get("/monitoring/failures", requireLogin, async (req, res) => {
  try {
    const failures = await listFailures({ limit: req.query.limit });
    res.json(failures);
  } catch (err) {
    respondError(res, 500, "Failed to fetch failures", err?.message ?? String(err));
  }
});

router.get("/monitoring/health", requireLogin, async (req, res) => {
  try {
    const health = await healthSnapshot();
    res.json(health);
  } catch (err) {
    respondError(res, 500, "Failed to fetch health", err?.message ?? String(err));
  }
});

module.exports = router;
