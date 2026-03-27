const DashboardManager = {
  initialized: false,

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    // Subscribe to live updates
    const status = await ApiClient.getJsonOptional("/setup/status");
    if (status?.user?.developerId) {
      SocketManager.init(status.user.developerId);
      SocketManager.addHandler((payload) => this.handleLiveUpdate(payload));
    }
  },

  async loadAll() {
    await this.init(); // Ensure WS is ready

    const [stats, analytics] = await Promise.all([
      ApiClient.getJson("/dashboard/stats"),
      ApiClient.getJsonOptional("/dashboard/analytics")
    ]);

    this.renderStats(stats);
    ChartManager.renderAll(analytics);
  },

  renderStats(stats) {
    const mapping = {
      statRepos: stats.repos,
      statCommits: stats.commits,
      statSkills: stats.skills,
      statArchitectures: stats.architectures,
      statRunningJobs: stats.monitoring?.runningJobs,
      statFailures24h: stats.monitoring?.failures24h
    };

    for (const [id, value] of Object.entries(mapping)) {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? "0";
    }
  },

  handleLiveUpdate(payload) {
    console.log("Dashboard Live Update:", payload);
    if (payload.target === "dashboard") {
      if (payload.type === "job_status" && (payload.data.status === "completed" || payload.data.status === "failed")) {
        this.loadAll();
      }
      
      if (payload.type === "job_status") {
        const el = document.getElementById("statLastJobStatus");
        if (el) el.textContent = `Live: ${payload.data.jobType || ""} ${payload.data.status}`;
      }
    }
  }
};

window.DashboardManager = DashboardManager;
