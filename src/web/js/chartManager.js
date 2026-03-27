const CHART_COLORS = {
  text: "#b7c6ff",
  grid: "#273056",
  accent: "#26B99A",
  warn: "#ff8f8f",
  muted: "#4c5c98",
  series: ["#26B99A", "#5b7cfa", "#e8a54b", "#c678dd", "#56b6c2", "#e06c75"],
};

const ChartManager = {
  charts: [],

  init() {
    if (typeof Chart !== "undefined") {
      Chart.defaults.color = CHART_COLORS.text;
      Chart.defaults.borderColor = CHART_COLORS.grid;
    }
  },

  destroyAll() {
    while (this.charts.length) {
      const c = this.charts.pop();
      try { c.destroy(); } catch (_) {}
    }
  },

  renderMonitoringLine(mon) {
    const canvas = document.getElementById("chartMonitoringLine");
    if (!canvas || !mon) return;

    const runsSeries = mon.runsByDay || [];
    const labels = runsSeries.map(d => String(d.date).slice(5));
    const runsData = runsSeries.map(d => d.count);
    const failData = (mon.failuresByDay || []).map(d => d.count);

    this.charts.push(new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Runs", data: runsData, borderColor: CHART_COLORS.accent, backgroundColor: "rgba(38,185,154,0.15)", fill: true, tension: 0.2 },
          { label: "Failures", data: failData, borderColor: CHART_COLORS.warn, backgroundColor: "rgba(255,143,143,0.08)", fill: true, tension: 0.2 },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    }));
  },

  renderJobStatus(mon) {
    const canvas = document.getElementById("chartJobStatus");
    if (!canvas || !mon) return;

    const rows = mon.jobStatus || [];
    const labels = rows.length ? rows.map(r => r.status) : ["No jobs"];
    const data = rows.length ? rows.map(r => r.count) : [1];

    this.charts.push(new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: CHART_COLORS.series }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    }));
  },

  renderTechStack(stacks) {
    const canvas = document.getElementById("chartTechStack");
    if (!canvas || !stacks) return;

    this.charts.push(new Chart(canvas, {
      type: "bar",
      data: {
        labels: stacks.map(t => t.name),
        datasets: [{ label: "%", data: stacks.map(t => t.percentage), backgroundColor: CHART_COLORS.accent }]
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
    }));
  },

  renderAll(analytics) {
    this.destroyAll();
    if (!analytics) return;
    this.renderMonitoringLine(analytics.monitoring);
    this.renderJobStatus(analytics.monitoring);
    this.renderTechStack(analytics.techStacks);
    // ... Add more as needed
  }
};

window.ChartManager = ChartManager;
