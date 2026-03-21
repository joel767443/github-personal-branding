const express = require("express");
const requireLogin = require("../middleware/requireLogin");
const { columnLabel, formatDateTime } = require("../services/viewHelpers");
const viewsDataService = require("../services/viewsDataService");

const router = express.Router();

router.get("/profile", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getProfileViewModel(req);
    res.render("partials/profile", { ...model, columnLabel, formatDateTime });
  } catch (err) {
    res
      .status(err?.status ?? 500)
      .json({ error: err?.message ?? "Failed to render profile", details: err?.details ?? null });
  }
});

router.get("/experience", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getExperienceViewModel(req);
    res.render("partials/experience", { ...model, formatDateTime });
  } catch (err) {
    res
      .status(err?.status ?? 500)
      .json({ error: err?.message ?? "Failed to render experience", details: err?.details ?? null });
  }
});

router.get("/portfolio", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getPortfolioTabsViewModel(req, req.query.tab);
    res.render("partials/portfolio", { ...model, formatDateTime, columnLabel });
  } catch (err) {
    res
      .status(err?.status ?? 500)
      .json({
        error: err?.message ?? "Failed to render portfolio",
        details: err?.details ?? null,
      });
  }
});

router.get("/projects", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getProjectsViewModel(req);
    res.render("partials/projects", { ...model, formatDateTime, columnLabel });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render projects" });
  }
});

router.get("/repos", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getReposViewModel(req);
    res.render("partials/repos", { ...model, formatDateTime, columnLabel });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render repos" });
  }
});

router.get("/education", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getEducationTabsViewModel(req, req.query.tab);
    res.render("partials/education", { ...model, columnLabel, formatDateTime });
  } catch (err) {
    res
      .status(err?.status ?? 500)
      .json({ error: err?.message ?? "Failed to render education", details: err?.details ?? null });
  }
});

router.get("/skills", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getSkillsTabsViewModel(req, req.query.tab);
    res.render("partials/skills", { ...model, columnLabel, formatDateTime });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render skills" });
  }
});

router.get("/endorsements", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getEndorsementsTabsViewModel(req, req.query.tab);
    res.render("partials/endorsements", { ...model, columnLabel, formatDateTime });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render endorsements" });
  }
});

router.get("/architectures", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getArchitecturesViewModel(req);
    res.render("partials/architectures", { ...model, columnLabel, formatDateTime });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render architectures" });
  }
});

// -------------------------
// Monitoring fragments
// -------------------------

router.get("/monitoring/shell", requireLogin, async (req, res) => {
  const activeTab = typeof req.query.activeTab === "string" ? req.query.activeTab : "runs";
  res.render("partials/monitoring/monitoringShell", { activeTab, columnLabel, formatDateTime });
});

router.get("/monitoring/runs", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getMonitoringRunsViewModel(req);
    res.render("partials/monitoring/monitoringRunsTable", { ...model, formatDateTime });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render runs" });
  }
});

router.get("/monitoring/health", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getMonitoringHealthViewModel(req);
    res.render("partials/_dataTable", {
      rows: [model.health],
      columnLabel,
    });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render health" });
  }
});

router.get("/monitoring/failures", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getMonitoringFailuresViewModel(req);
    res.render("partials/monitoring/monitoringFailuresTable", { ...model, columnLabel, formatDateTime });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render failures" });
  }
});

router.get("/monitoring/runs/:runId/events", requireLogin, async (req, res) => {
  try {
    const model = await viewsDataService.getMonitoringEventsViewModel(req.params.runId, {
      limit: req.query.limit,
    });
    res.render("partials/_dataTable", { rows: model.events, columnLabel });
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to render events" });
  }
});

module.exports = router;

