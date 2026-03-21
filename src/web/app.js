async function getJson(url, opts) {
  const resp = await fetch(url, {
    credentials: "include",
    ...(opts ?? {}),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || json?.details || `Request failed (${resp.status})`);
  return json;
}

async function getJsonOptional(url, opts) {
  try {
    return await getJson(url, opts);
  } catch {
    return null;
  }
}

function setLoadingState(container, message) {
  if (!container) return;
  container.innerHTML = "";
  const div = document.createElement("div");
  div.className = "muted";
  div.textContent = message ?? "Loading…";
  container.appendChild(div);
}

function setErrorState(container, message) {
  if (!container) return;
  container.innerHTML = "";
  const div = document.createElement("div");
  div.className = "err";
  div.textContent = message ?? "Something went wrong";
  container.appendChild(div);
}

function setHidden(el, shouldHide) {
  if (!el) return;
  el.classList.toggle("hidden", Boolean(shouldHide));
}

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userMenuButton = document.getElementById("userMenuButton");
const userMenuDropdown = document.getElementById("userMenuDropdown");
const setupCard = document.getElementById("setupCard");
const syncCard = document.getElementById("syncCard");
const setupMsg = document.getElementById("setupMsg");
const syncState = document.getElementById("syncState");
const progressLog = document.getElementById("progressLog");
const startSyncBtn = document.getElementById("startSyncBtn");
const saveSetupBtn = document.getElementById("saveSetupBtn");
const pageTitle = document.getElementById("pageTitle");
const sidebarEl = document.getElementById("sidebar");
const topNavEl = document.getElementById("topNav");
const dashboardCard = document.getElementById("dashboardCard");
const loginCard = document.getElementById("loginCard");
const loginPageBtn = document.getElementById("loginPageBtn");
const loginMsg = document.getElementById("loginMsg");
const profileAvatar = document.getElementById("profileAvatar");
const profileLogin = document.getElementById("profileLogin");
const profileName = document.getElementById("profileName");
const profilePhone = document.getElementById("profilePhone");
const profileEmail = document.getElementById("profileEmail");
const sidebarAvatar = document.getElementById("sidebarAvatar");
const sidebarName = document.getElementById("sidebarName");
const sidebarPhone = document.getElementById("sidebarPhone");
const sidebarEmail = document.getElementById("sidebarEmail");
const profileJobTitle = document.getElementById("profileJobTitle");
const profileHireable = document.getElementById("profileHireable");
const profileHeadline = document.getElementById("profileHeadline");
const profileSummary = document.getElementById("profileSummary");
const topUserAvatar = document.getElementById("topUserAvatar");
const topUserLogin = document.getElementById("topUserLogin");
const statDevelopers = document.getElementById("statDevelopers");
const statRepos = document.getElementById("statRepos");
const statCommits = document.getElementById("statCommits");
const statSkills = document.getElementById("statSkills");
const statEndorsements = document.getElementById("statEndorsements");
const statRecommendations = document.getElementById("statRecommendations");
const statExperiences = document.getElementById("statExperiences");
const statPublications = document.getElementById("statPublications");
const statArchitectures = document.getElementById("statArchitectures");
const statDeveloperTechStacks = document.getElementById("statDeveloperTechStacks");
const statDeveloperArchitectures = document.getElementById("statDeveloperArchitectures");
const statRunningJobs = document.getElementById("statRunningJobs");
const statFailures24h = document.getElementById("statFailures24h");
const statLastJobStatus = document.getElementById("statLastJobStatus");
const uploadCard = document.getElementById("uploadCard");
const linkedinZipInput = document.getElementById("linkedinZip");
const uploadLinkedinZipBtn = document.getElementById("uploadLinkedinZipBtn");
const uploadStatus = document.getElementById("uploadStatus");
const linkedinProgressLog = document.getElementById("linkedinProgressLog");
const dataPageCard = document.getElementById("dataPageCard");
const dataPageTitle = document.getElementById("dataPageTitle");
const dataPageSubtitle = document.getElementById("dataPageSubtitle");
const dataPageContent = document.getElementById("dataPageContent");
const POST_SETUP_AWAIT_GITHUB_KEY = "pdbs_await_github_after_setup";

let statusCache = null;
let progressSSE = null;
let dashboardLoading = false;
let dataPageLoading = false;
/** @type {any[]} */
const dashboardChartList = [];

const CHART_COLORS = {
  text: "#b7c6ff",
  grid: "#273056",
  accent: "#26B99A",
  warn: "#ff8f8f",
  muted: "#4c5c98",
  series: ["#26B99A", "#5b7cfa", "#e8a54b", "#c678dd", "#56b6c2", "#e06c75"],
};

function destroyDashboardCharts() {
  while (dashboardChartList.length) {
    const c = dashboardChartList.pop();
    try {
      c.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}

function shortDayLabel(isoDate) {
  if (!isoDate || String(isoDate).length < 10) return String(isoDate ?? "");
  return String(isoDate).slice(5);
}

function renderDashboardCharts(analytics) {
  destroyDashboardCharts();
  if (typeof Chart === "undefined") return;
  if (!analytics) return;

  Chart.defaults.color = CHART_COLORS.text;
  Chart.defaults.borderColor = CHART_COLORS.grid;

  const mon = analytics.monitoring || {};
  const runsSeries = mon.runsByDay || [];
  const lineLabels = runsSeries.map((d) => shortDayLabel(d.date));
  const runsData = runsSeries.map((d) => d.count);
  const failData = (mon.failuresByDay || []).map((d) => d.count);

  const lineCanvas = document.getElementById("chartMonitoringLine");
  if (lineCanvas) {
    dashboardChartList.push(
      new Chart(lineCanvas, {
        type: "line",
        data: {
          labels: lineLabels,
          datasets: [
            {
              label: "Runs",
              data: runsData,
              borderColor: CHART_COLORS.accent,
              backgroundColor: "rgba(38,185,154,0.15)",
              fill: true,
              tension: 0.2,
            },
            {
              label: "Failures",
              data: failData,
              borderColor: CHART_COLORS.warn,
              backgroundColor: "rgba(255,143,143,0.08)",
              fill: true,
              tension: 0.2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
            },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
          plugins: { legend: { position: "bottom" } },
        },
      }),
    );
  }

  const statusRows = mon.jobStatus || [];
  const stLabels = statusRows.length ? statusRows.map((r) => r.status) : ["No jobs"];
  const stData = statusRows.length ? statusRows.map((r) => r.count) : [1];
  const stColors = statusRows.length
    ? CHART_COLORS.series.slice(0, Math.max(stLabels.length, 1))
    : [CHART_COLORS.muted];

  const statusCanvas = document.getElementById("chartJobStatus");
  if (statusCanvas) {
    dashboardChartList.push(
      new Chart(statusCanvas, {
        type: "doughnut",
        data: {
          labels: stLabels,
          datasets: [{ data: stData, backgroundColor: stColors }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      }),
    );
  }

  const typeRows = mon.jobType || [];
  const tyLabels = typeRows.length ? typeRows.map((r) => r.jobType) : ["No jobs"];
  const tyData = typeRows.length ? typeRows.map((r) => r.count) : [1];
  const tyColors = typeRows.length
    ? CHART_COLORS.series.slice(0, Math.max(tyLabels.length, 1))
    : [CHART_COLORS.muted];

  const typeCanvas = document.getElementById("chartJobType");
  if (typeCanvas) {
    dashboardChartList.push(
      new Chart(typeCanvas, {
        type: "doughnut",
        data: {
          labels: tyLabels,
          datasets: [{ data: tyData, backgroundColor: tyColors }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
        },
      }),
    );
  }

  const end = analytics.endorsementsBySkill || [];
  const endLabels = end.map((e) => e.skillName || "—");
  const endCounts = end.map((e) => e.count);

  const endCanvas = document.getElementById("chartEndorsements");
  if (endCanvas) {
    dashboardChartList.push(
      new Chart(endCanvas, {
        type: "bar",
        data: {
          labels: endLabels.length ? endLabels : ["No endorsements"],
          datasets: [
            {
              label: "Endorsements",
              data: endCounts.length ? endCounts : [0],
              backgroundColor: CHART_COLORS.series[1],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { maxRotation: 45, minRotation: 0 } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
          plugins: { legend: { display: false } },
        },
      }),
    );
  }

  const stacks = analytics.techStacks || [];
  const stackLabels = stacks.map((t) => t.name);
  const stackPct = stacks.map((t) => t.percentage);

  const stackCanvas = document.getElementById("chartTechStack");
  if (stackCanvas) {
    dashboardChartList.push(
      new Chart(stackCanvas, {
        type: "bar",
        data: {
          labels: stackLabels.length ? stackLabels : ["No tech stack data"],
          datasets: [
            {
              label: "%",
              data: stackLabels.length ? stackPct : [0],
              backgroundColor: CHART_COLORS.accent,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, max: 100 } },
          plugins: { legend: { display: false } },
        },
      }),
    );
  }

  const arch = analytics.architectures || [];
  const archLabels = arch.map((a) => a.name);
  const archCounts = arch.map((a) => a.count);

  const archCanvas = document.getElementById("chartArchitecture");
  if (archCanvas) {
    dashboardChartList.push(
      new Chart(archCanvas, {
        type: "bar",
        data: {
          labels: archLabels.length ? archLabels : ["No patterns"],
          datasets: [
            {
              label: "Repos",
              data: archLabels.length ? archCounts : [0],
              backgroundColor: CHART_COLORS.series[2],
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
          plugins: { legend: { display: false } },
        },
      }),
    );
  }

  const roles = (analytics.experience && analytics.experience.roles) || [];
  const expLabels = roles.map((r) =>
    r.label.length > 48 ? `${r.label.slice(0, 45)}…` : r.label,
  );
  const expData = roles.map((_, i) => roles.length - i);

  const expCanvas = document.getElementById("chartExperience");
  if (expCanvas) {
    dashboardChartList.push(
      new Chart(expCanvas, {
        type: "bar",
        data: {
          labels: expLabels.length ? expLabels : ["No experience rows"],
          datasets: [
            {
              label: "Roles",
              data: expLabels.length ? expData : [0],
              backgroundColor: CHART_COLORS.series[3],
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
          },
          plugins: { legend: { display: false } },
        },
      }),
    );
  }
}

function addLog(line, type, container) {
  const el = container ?? progressLog;
  if (!el) return;
  const div = document.createElement("div");
  if (type === "error") div.className = "err";
  if (type === "ok") div.className = "ok";
  div.textContent = line;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function clearDashboard() {
  destroyDashboardCharts();
  if (!dashboardCard) return;
  if (profileAvatar) {
    setHidden(profileAvatar, true);
    profileAvatar.src = "";
  }
  if (profileLogin) profileLogin.textContent = "";
  if (profileName) profileName.textContent = "";
  if (profilePhone) profilePhone.textContent = "";
  if (profileEmail) profileEmail.textContent = "";
  if (profileJobTitle) profileJobTitle.textContent = "";
  if (profileHireable) profileHireable.textContent = "";
  if (profileHeadline) profileHeadline.textContent = "";
  if (profileSummary) profileSummary.textContent = "";
  if (statDevelopers) statDevelopers.textContent = "";
  if (statRepos) statRepos.textContent = "";
  if (statCommits) statCommits.textContent = "";
  if (statSkills) statSkills.textContent = "";
  if (statEndorsements) statEndorsements.textContent = "";
  if (statRecommendations) statRecommendations.textContent = "";
  if (statExperiences) statExperiences.textContent = "";
  if (statPublications) statPublications.textContent = "";
  if (statArchitectures) statArchitectures.textContent = "";
  if (statDeveloperTechStacks) statDeveloperTechStacks.textContent = "";
  if (statDeveloperArchitectures) statDeveloperArchitectures.textContent = "";
  if (statRunningJobs) statRunningJobs.textContent = "";
  if (statFailures24h) statFailures24h.textContent = "";
  if (statLastJobStatus) statLastJobStatus.textContent = "";
}

async function loadDashboardData() {
  if (dashboardLoading) return;
  dashboardLoading = true;
  try {
    const [profile, stats, analytics, overview] = await Promise.all([
      getJson("/profile/me"),
      getJson("/dashboard/stats"),
      getJsonOptional("/dashboard/analytics"),
      getJsonOptional("/data/overview"),
    ]);

    const s = analytics?.summary;
    const o = overview;

    if (profileAvatar) {
      if (profile?.avatarUrl) {
        profileAvatar.src = profile.avatarUrl;
        setHidden(profileAvatar, false);
      } else {
        setHidden(profileAvatar, true);
      }
    }

    if (profileLogin) profileLogin.textContent = profile?.login ?? "";
    const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
    if (profileName) profileName.textContent = fullName || profile?.login || "";
    if (profilePhone) profilePhone.textContent = profile?.phoneNumber ?? "";
    if (profileEmail) profileEmail.textContent = profile?.email ?? "";
    if (profileJobTitle) profileJobTitle.textContent = profile?.jobTitle ?? "";
    if (profileHireable) {
      profileHireable.textContent =
        profile?.hireable == null ? "" : profile.hireable ? "Hireable: Yes" : "Hireable: No";
    }
    if (profileHeadline) profileHeadline.textContent = profile?.headline ?? "";
    if (profileSummary) profileSummary.textContent = profile?.summary ?? "";

    if (statDevelopers) statDevelopers.textContent = String(stats?.developers ?? "");
    if (statRepos) statRepos.textContent = String(s?.repos ?? o?.repos ?? stats?.repos ?? "");
    if (statCommits) statCommits.textContent = String(s?.commits ?? stats?.commits ?? "");
    if (statSkills) statSkills.textContent = String(s?.skills ?? o?.skills ?? "");
    if (statEndorsements) statEndorsements.textContent = String(s?.endorsements ?? o?.endorsements ?? "");
    if (statRecommendations) statRecommendations.textContent = String(s?.recommendations ?? o?.recommendations ?? "");
    if (statExperiences) statExperiences.textContent = String(s?.experiences ?? o?.experiences ?? "");
    if (statPublications) statPublications.textContent = String(s?.publications ?? o?.publications ?? "");
    if (statArchitectures) statArchitectures.textContent = String(s?.architecturesCatalog ?? stats?.architectures ?? "");
    if (statDeveloperTechStacks) statDeveloperTechStacks.textContent = String(s?.developerTechStacks ?? stats?.developerTechStacks ?? "");
    if (statDeveloperArchitectures) statDeveloperArchitectures.textContent = String(s?.developerArchitectures ?? stats?.developerArchitectures ?? "");
    const mon = analytics?.monitoring ?? stats?.monitoring;
    if (statRunningJobs) statRunningJobs.textContent = String(mon?.runningJobs ?? 0);
    if (statFailures24h) statFailures24h.textContent = String(mon?.failures24h ?? 0);
    if (statLastJobStatus) {
      const a = mon?.lastSyncStatus ?? "-";
      const b = mon?.lastImportStatus ?? "-";
      statLastJobStatus.textContent = `Sync: ${a} · LinkedIn: ${b}`;
    }

    renderDashboardCharts(analytics);

    // Sidebar profile (Gentelella-like)
    if (sidebarAvatar) {
      if (profile?.avatarUrl) {
        sidebarAvatar.src = profile.avatarUrl;
        setHidden(sidebarAvatar, false);
      } else {
        setHidden(sidebarAvatar, true);
      }
    }
    if (sidebarName) sidebarName.textContent = profileName.textContent || "";
    if (sidebarPhone) sidebarPhone.textContent = profilePhone.textContent || "";
    if (sidebarEmail) sidebarEmail.textContent = profileEmail.textContent || "";
  } catch (err) {
    // Keep UI quiet; user will see a blank dashboard if API fails.
  } finally {
    dashboardLoading = false;
  }
}

/** Ensures the displayed page title starts with an uppercase letter. Other casing is unchanged. */
function capitalizePageTitle(s) {
  const t = String(s ?? "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function currentDataRoute() {
  const p = window.location.pathname || "/";
  // Dashboard content lives only at `/dashboard`. `/` is reserved for setup/login shell.
  if (p === "/") {
    return null;
  }
  if (p === "/dashboard") {
    return {
      api: null,
      title: capitalizePageTitle("Dashboard"),
      subtitle: "Overview and stats",
      kind: "dashboard",
    };
  }
  if (p === "/profile") {
    return {
      api: "/data/profile",
      title: capitalizePageTitle("Profile"),
      kind: "data",
      page: "profile",
    };
  }
  if (p === "/monitoring") {
    return {
      api: "/monitoring/runs?limit=50",
      title: capitalizePageTitle("Monitoring"),
      kind: "data",
      page: "monitoring",
    };
  }
  if (!p.startsWith("/data/")) return null;
  const page = p.slice("/data/".length);
  if (page === "commits") return null; // Commit URL removed; commits are still stored in DB.
  if (["repos", "projects"].includes(page)) {
    return {
      api: "/data/portfolio",
      title: "Portfolio",
      kind: "data",
      page: "portfolio",
      portfolioTab: page,
    };
  }
  if (page === "portfolio") {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("tab");
    const normalized = tab === "repos" || tab === "projects" ? tab : undefined;
    return {
      api: "/data/portfolio",
      title: "Portfolio",
      kind: "data",
      page: "portfolio",
      ...(normalized ? { portfolioTab: normalized } : {}),
    };
  }
  if (["education", "certifications", "publications"].includes(page)) {
    return {
      api: "/data/education",
      title: "Education",
      kind: "data",
      page: "education",
      educationTab: page,
    };
  }
  if (["skills", "developer-tech-stacks", "architectures"].includes(page)) {
    return {
      api: "/data/skills",
      title: "Skills",
      kind: "data",
      page: "skills",
      skillsTab: page,
    };
  }
  if (["endorsements", "recommendations"].includes(page)) {
    return {
      api: "/data/endorsements",
      title: "Endorsements",
      kind: "data",
      page: "endorsements",
      endorsementsTab: page,
    };
  }
  const title = capitalizePageTitle(
    page === "profile" ? "Profile" : page.replaceAll("-", " "),
  );
  return {
    api: `/data/${page}`,
    title,
    kind: "data",
    page,
  };
}

async function loadDataPage() {
  const route = currentDataRoute();
  if (!route || route.kind === "upload" || dataPageLoading) return;
  if (!dataPageContent) return;

  dataPageLoading = true;
  try {
    if (dataPageTitle) dataPageTitle.textContent = route.title ?? "";
    if (dataPageSubtitle) dataPageSubtitle.textContent = route.subtitle ?? "";
    dataPageContent.onclick = null;

    setLoadingState(dataPageContent, "Loading...");

    const getHtml = async (url) => {
      const resp = await fetch(url, { credentials: "include" });
      const text = await resp.text().catch(() => "");
      if (resp.ok) return text;
      // Try to extract meaningful server-side error.
      try {
        const json = JSON.parse(text);
        throw new Error(json?.error || json?.details || text || `Request failed (${resp.status})`);
      } catch {
        throw new Error(text || `Request failed (${resp.status})`);
      }
    };

    if (route?.page === "profile") {
      dataPageContent.innerHTML = await getHtml("/views/profile");
    } else if (route?.page === "experience") {
      dataPageContent.innerHTML = await getHtml("/views/experience");
    } else if (route?.page === "projects") {
      dataPageContent.innerHTML = await getHtml("/views/projects");
    } else if (route?.page === "repos") {
      dataPageContent.innerHTML = await getHtml("/views/repos");
    } else if (route?.page === "architectures") {
      dataPageContent.innerHTML = await getHtml("/views/architectures");
    } else if (route?.page === "monitoring") {
      const shellHtml = await getHtml("/views/monitoring/shell?activeTab=runs");
      dataPageContent.innerHTML = shellHtml;
      const tabContent = document.getElementById("monitoringTabContent");

      const setTabActive = (tab) => {
        const buttons = dataPageContent.querySelectorAll("button[data-monitoring-tab]");
        for (const b of buttons) {
          const isActive = b.getAttribute("data-monitoring-tab") === tab;
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        }
      };

      const loadTab = async (tab) => {
        setTabActive(tab);
        if (!tabContent) return;
        setLoadingState(tabContent, "Loading…");
        try {
          if (tab === "health") {
            tabContent.innerHTML = await getHtml("/views/monitoring/health");
          } else if (tab === "failures") {
            tabContent.innerHTML = await getHtml("/views/monitoring/failures?limit=50");
          } else {
            tabContent.innerHTML = await getHtml("/views/monitoring/runs?limit=50");
          }
        } catch (err) {
          setErrorState(tabContent, err?.message || String(err));
        }
      };

      dataPageContent.onclick = async (ev) => {
        const btn = ev.target?.closest?.("button[data-monitoring-tab]");
        const actionBtn = ev.target?.closest?.("button[data-monitoring-action='events']");

        if (btn) {
          const tab = btn.getAttribute("data-monitoring-tab");
          if (tab) await loadTab(tab);
          return;
        }

        if (actionBtn) {
          const runId = actionBtn.getAttribute("data-run-id");
          if (!runId) return;
          setLoadingState(tabContent, `Loading events for ${runId}…`);
          try {
            tabContent.innerHTML = await getHtml(
              `/views/monitoring/runs/${encodeURIComponent(runId)}/events?limit=200`,
            );
          } catch (err) {
            setErrorState(tabContent, err?.message || String(err));
          }
        }
      };

      await loadTab("runs");
    } else if (route?.page === "portfolio") {
      const initialTab = route?.portfolioTab ?? "repos";
      const tabParam = encodeURIComponent(initialTab);
      dataPageContent.innerHTML = await getHtml(`/views/portfolio?tab=${tabParam}`);

      const setActiveTab = (tabKey) => {
        const buttons = dataPageContent.querySelectorAll("button[data-portfolio-tab]");
        for (const b of buttons) {
          const isActive = b.getAttribute("data-portfolio-tab") === tabKey;
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        const panels = dataPageContent.querySelectorAll(".portfolioTabPanel[data-portfolio-panel]");
        for (const panel of panels) {
          const key = panel.getAttribute("data-portfolio-panel");
          panel.classList.toggle("hidden", key !== tabKey);
        }
      };

      dataPageContent.onclick = (ev) => {
        const btn = ev.target?.closest?.("button[data-portfolio-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-portfolio-tab");
        if (!tabKey) return;
        setActiveTab(tabKey);
      };
    } else if (route?.page === "education") {
      const initialTab = route?.educationTab ?? "education";
      const tabParam = encodeURIComponent(initialTab);
      dataPageContent.innerHTML = await getHtml(`/views/education?tab=${tabParam}`);

      const setActiveTab = (tabKey) => {
        const buttons = dataPageContent.querySelectorAll("button[data-education-tab]");
        for (const b of buttons) {
          const isActive = b.getAttribute("data-education-tab") === tabKey;
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        const panels = dataPageContent.querySelectorAll(".educationTabPanel[data-education-panel]");
        for (const panel of panels) {
          const key = panel.getAttribute("data-education-panel");
          panel.classList.toggle("hidden", key !== tabKey);
        }
      };

      dataPageContent.onclick = (ev) => {
        const btn = ev.target?.closest?.("button[data-education-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-education-tab");
        if (!tabKey) return;
        setActiveTab(tabKey);
      };
    } else if (route?.page === "skills") {
      const initialTab = route?.skillsTab ?? "skills";
      const tabParam = encodeURIComponent(initialTab);
      dataPageContent.innerHTML = await getHtml(`/views/skills?tab=${tabParam}`);

      const setActiveTab = (tabKey) => {
        const buttons = dataPageContent.querySelectorAll("button[data-skills-tab]");
        for (const b of buttons) {
          const isActive = b.getAttribute("data-skills-tab") === tabKey;
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        const panels = dataPageContent.querySelectorAll(".skillsTabPanel[data-skills-panel]");
        for (const panel of panels) {
          const key = panel.getAttribute("data-skills-panel");
          panel.classList.toggle("hidden", key !== tabKey);
        }
      };

      dataPageContent.onclick = (ev) => {
        const btn = ev.target?.closest?.("button[data-skills-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-skills-tab");
        if (!tabKey) return;
        setActiveTab(tabKey);
      };
    } else if (route?.page === "endorsements") {
      const initialTab = route?.endorsementsTab ?? "endorsements";
      const tabParam = encodeURIComponent(initialTab);
      dataPageContent.innerHTML = await getHtml(`/views/endorsements?tab=${tabParam}`);

      const setActiveTab = (tabKey) => {
        const buttons = dataPageContent.querySelectorAll("button[data-endorsement-tab]");
        for (const b of buttons) {
          const isActive = b.getAttribute("data-endorsement-tab") === tabKey;
          b.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        const panels = dataPageContent.querySelectorAll(".endorsementTabPanel[data-endorsement-panel]");
        for (const panel of panels) {
          const key = panel.getAttribute("data-endorsement-panel");
          panel.classList.toggle("hidden", key !== tabKey);
        }
      };

      dataPageContent.onclick = (ev) => {
        const btn = ev.target?.closest?.("button[data-endorsement-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-endorsement-tab");
        if (!tabKey) return;
        setActiveTab(tabKey);
      };
    } else {
      throw new Error(`Unsupported page: ${route?.page ?? "(unknown)"}`);
    }
  } catch (err) {
    setErrorState(dataPageContent, err?.message || String(err));
  } finally {
    dataPageLoading = false;
  }
}

async function refreshStatus() {
  try {
    const status = await getJson("/setup/status");
    statusCache = status;
    if (status.authenticated) {
      sessionStorage.removeItem(POST_SETUP_AWAIT_GITHUB_KEY);
    }
    const postSetupAwaitingAuth =
      sessionStorage.getItem(POST_SETUP_AWAIT_GITHUB_KEY) === "1" &&
      !status.authenticated &&
      (status.missing?.length ?? 0) === 0;

    const showSetup = status.wizardStep === "setup";
    const showLogin = status.wizardStep === "login";
    const showSync = status.wizardStep === "sync";
    const showUploadStep = status.wizardStep === "upload";

    if (
      (window.location.pathname || "/") === "/" &&
      status.authenticated &&
      !showSetup &&
      !showLogin
    ) {
      window.history.replaceState(null, "", "/dashboard");
    }

    const route = currentDataRoute();

    const forceUploadUi = route?.kind === "upload";
    const isDashboardRoute = route?.kind === "dashboard";
    const isProfilePage = (window.location.pathname || "") === "/profile";
    const syncCompleted = Boolean(status?.syncCompleted);

    // Dashboard is only `/dashboard`, never on `/`, setup, login, or other routes.
    const showDashboard =
      status.authenticated && !showSetup && !showLogin && isDashboardRoute;

    // Gentelella shell visibility: hide sidebar/topbar on Step 1, login, or post-setup Step 2 gate.
    const hideShell = showSetup || showLogin || postSetupAwaitingAuth;
    setHidden(sidebarEl, hideShell);
    setHidden(topNavEl, hideShell);

    const showDashboardCard = showDashboard && !postSetupAwaitingAuth;
    setHidden(dashboardCard, !showDashboardCard);

    const showDataPageCard =
      !postSetupAwaitingAuth && !showSetup && !showLogin && Boolean(route) && route.kind === "data";
    setHidden(dataPageCard, !showDataPageCard);

    pageTitle.textContent = capitalizePageTitle(
      showSetup
        ? "Initial Setup"
        : postSetupAwaitingAuth
          ? "Sync GitHub Data"
          : showLogin
            ? "Sign in"
            : route
              ? (route.title || "Data")
              : forceUploadUi
                ? "LinkedIn Upload"
                : "PDBS",
    );

    setHidden(setupCard, !showSetup);
    // Match dashboard: Step 2 / sync UX only on `/dashboard`, not on Profile or other data routes.
    const showSyncCard =
      postSetupAwaitingAuth || (showSync && !forceUploadUi && isDashboardRoute);
    setHidden(syncCard, !showSyncCard);
    setHidden(loginCard, !(showLogin && !postSetupAwaitingAuth));
    // Only show LinkedIn upload UI on the dedicated upload route,
    // or on the Profile page when GitHub sync is complete (allows re-upload).
    const showUploadCard =
      !showSetup &&
      !showLogin &&
      (forceUploadUi ||
        (!isDashboardRoute && isProfilePage && (showUploadStep || syncCompleted)));
    setHidden(uploadCard, !showUploadCard);

    if (!showSetup && status.authenticated) {
      if (topUserAvatar) {
        topUserAvatar.src = status.user?.avatarUrl ?? "";
        setHidden(topUserAvatar, !status.user?.avatarUrl);
      }
      if (topUserLogin) topUserLogin.textContent = status.user?.login ?? "";
      setHidden(userMenuButton, false);
      setHidden(loginBtn, true);

      // Left sidebar profile (fallback to session data)
      // `/profile/me` may fail (e.g. DB connectivity), but session user data is still usable.
      if (sidebarAvatar) {
        const avatar = status.user?.avatarUrl ?? "";
        sidebarAvatar.src = avatar;
        setHidden(sidebarAvatar, !avatar);
      }
      if (sidebarName) sidebarName.textContent = status.user?.name ?? status.user?.login ?? "";
      if (sidebarEmail) sidebarEmail.textContent = status.user?.email ?? "";
      if (sidebarPhone) sidebarPhone.textContent = "";
    } else if (!showSetup && status.authConfigured) {
      setHidden(userMenuButton, true);
      userMenuDropdown.classList.remove("open");
      setHidden(loginBtn, false);
    } else {
      setHidden(userMenuButton, true);
      setHidden(loginBtn, true);
      userMenuDropdown.classList.remove("open");
    }

    // Don't load dashboard data when forcing upload-only UI.
    if (showSetup || !status.authenticated || forceUploadUi || (route && route.kind !== "dashboard")) {
      clearDashboard();
    } else {
      loadDashboardData();
    }
    if (!showSetup && !showLogin && status.authenticated && route?.kind === "data") {
      loadDataPage().catch((err) => console.error("loadDataPage failed:", err));
    }

    if (showSetup) {
      setupMsg.textContent = `Missing config: ${status.missing.join(", ")}`;
      syncState.textContent = "Blocked until setup is complete";
      startSyncBtn.disabled = true;
      if (progressSSE) {
        progressSSE.close();
        progressSSE = null;
      }
    } else if (postSetupAwaitingAuth) {
      syncState.textContent = "Sign in with GitHub to run your first sync.";
      startSyncBtn.disabled = false;
    } else if (showLogin) {
      if (loginMsg) loginMsg.textContent = "Login required. Click the button below.";
      syncState.textContent = "Login required to start sync";
      startSyncBtn.disabled = true;
    } else if (!status.authenticated) {
      syncState.textContent = "Login required to start sync";
      startSyncBtn.disabled = true;
    } else if (status.syncInProgress) {
      syncState.textContent = "Sync running...";
      startSyncBtn.disabled = true;
    } else if (status.linkedinImportInProgress) {
      syncState.textContent = "LinkedIn import running...";
      startSyncBtn.disabled = true;
    } else if (showUploadStep) {
      syncState.textContent = "Sync complete";
      startSyncBtn.disabled = false;
    } else {
      syncState.textContent = "Ready";
      startSyncBtn.disabled = false;
    }

    if (startSyncBtn) {
      startSyncBtn.textContent = postSetupAwaitingAuth ? "Sign in with GitHub" : "Start Sync";
    }

    if (
      status.authenticated &&
      !progressSSE &&
      (showSync ||
        showUploadStep ||
        forceUploadUi ||
        status.syncInProgress ||
        status.linkedinImportInProgress)
    ) {
      openProgressSSE();
    }

    if (uploadLinkedinZipBtn && showUploadCard) {
      uploadLinkedinZipBtn.disabled = Boolean(status.syncInProgress || status.linkedinImportInProgress);
    }

    syncSidebarActiveFromPath();
  } catch (err) {
    syncState.textContent = `Status failed: ${err.message}`;
  }
}

async function submitSetup() {
  try {
    saveSetupBtn.disabled = true;
    setupMsg.textContent = "Saving setup...";
    const payload = {
      port: document.getElementById("port").value,
      githubToken: document.getElementById("githubToken").value,
      githubUsername: document.getElementById("githubUsername").value,
      githubClientId: document.getElementById("githubClientId").value,
      githubClientSecret: document.getElementById("githubClientSecret").value,
      dbHost: document.getElementById("dbHost").value,
      dbPort: document.getElementById("dbPort").value,
      dbUser: document.getElementById("dbUser").value,
      dbPassword: document.getElementById("dbPassword").value,
      dbName: document.getElementById("dbName").value,
    };
    const out = await getJson("/setup/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setupMsg.textContent = out.message || "Saved.";
    if (out.nextAuthUrl) {
      sessionStorage.setItem(POST_SETUP_AWAIT_GITHUB_KEY, "1");
      addLog("Setup saved. Continue with Step 2, then sign in with GitHub.", "ok");
      await refreshStatus();
      return;
    }
    if (out.restartRequired) {
      addLog("Setup saved. Restart server to apply values.", "ok");
    }
    await refreshStatus();
  } catch (err) {
    setupMsg.textContent = err.message;
  } finally {
    saveSetupBtn.disabled = false;
  }
}

function openProgressSSE() {
  if (progressSSE) return;
  const es = new EventSource("/sync/progress");
  progressSSE = es;
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      const job = data.job ?? "sync";
      const logTarget = job === "linkedin" ? linkedinProgressLog : progressLog;
      addLog(`[${data.at}] ${data.label}`, null, logTarget ?? progressLog);
      if (data.type === "done") {
        if (job === "linkedin") {
          uploadStatus.className = "ok";
          let msg = `Import complete${data.filename ? ` (${data.filename})` : ""}.`;
          if (data.import && typeof data.import === "object") {
            const nonzero = Object.entries(data.import).filter(([, v]) => Number(v) > 0);
            if (nonzero.length) {
              msg += ` ${nonzero.map(([k, v]) => `${k}: ${v}`).join(", ")}.`;
            }
          }
          uploadStatus.textContent = msg;
          if (uploadLinkedinZipBtn) uploadLinkedinZipBtn.disabled = false;
        } else {
          syncState.textContent = "Sync complete";
          startSyncBtn.disabled = false;
        }
        refreshStatus();
      }
      if (data.type === "error") {
        if (job === "linkedin") {
          uploadStatus.className = "err";
          uploadStatus.textContent = data.error || "LinkedIn import failed";
          addLog(data.error || "Unknown import error", "error", linkedinProgressLog ?? progressLog);
          if (uploadLinkedinZipBtn) uploadLinkedinZipBtn.disabled = false;
        } else {
          syncState.textContent = "Sync failed";
          addLog(data.error || "Unknown sync error", "error");
          startSyncBtn.disabled = false;
        }
        refreshStatus();
      }
    } catch {
      addLog(ev.data);
    }
  };
  es.onerror = () => {
    // If auth/setup is not ready, close and wait for next status refresh.
    if (!statusCache?.authenticated || statusCache?.missing?.length > 0) {
      es.close();
      progressSSE = null;
    }
  };
}

async function startSync() {
  try {
    startSyncBtn.disabled = true;
    syncState.textContent = "Starting sync...";
    if (!progressSSE) openProgressSSE();
    const out = await getJson("/sync/start", { method: "POST" });
    addLog(`Sync started (${out.runId})`, "ok");
    syncState.textContent = "Sync running...";
    await refreshStatus();
  } catch (err) {
    syncState.textContent = err.message;
    startSyncBtn.disabled = false;
  }
}

async function handleLinkedinUpload() {
  const file = linkedinZipInput.files?.[0];
  if (!file) {
    uploadStatus.className = "err";
    uploadStatus.textContent = "Please select a ZIP file first.";
    return;
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    uploadStatus.className = "err";
    uploadStatus.textContent = "Only .zip files are allowed.";
    return;
  }
  uploadLinkedinZipBtn.disabled = true;
  uploadStatus.className = "muted";
  uploadStatus.textContent = "Uploading…";
  if (linkedinProgressLog) linkedinProgressLog.innerHTML = "";
  if (!progressSSE) openProgressSSE();
  try {
    const fd = new FormData();
    fd.append("linkedinZip", file);
    const resp = await fetch("/upload/linkedin", {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail =
        typeof json?.details === "string"
          ? json.details
          : json?.details && typeof json.details === "object"
            ? JSON.stringify(json.details)
            : json?.error;
      throw new Error(detail || `Upload failed (${resp.status})`);
    }
    const kb = json.size != null ? (Number(json.size) / 1024).toFixed(1) : "?";
    uploadStatus.textContent = `ZIP received (${kb} KB). Import started${json.runId ? ` — ${json.runId}` : ""}. Progress below.`;
    addLog(`LinkedIn import job queued (${json.runId || "run"})`, "ok", linkedinProgressLog ?? progressLog);
  } catch (err) {
    uploadStatus.className = "err";
    uploadStatus.textContent = err.message || String(err);
    uploadLinkedinZipBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", () => {
  window.location.href = "/auth/github";
});

loginPageBtn?.addEventListener("click", () => {
  window.location.href = "/auth/github";
});

userMenuButton.addEventListener("click", () => {
  userMenuDropdown.classList.toggle("open");
});

logoutBtn.addEventListener("click", () => {
  window.location.href = "/auth/logout";
});

document.addEventListener("click", (ev) => {
  if (!userMenuDropdown.contains(ev.target) && !userMenuButton.contains(ev.target)) {
    userMenuDropdown.classList.remove("open");
  }
});

saveSetupBtn.addEventListener("click", submitSetup);
startSyncBtn.addEventListener("click", () => {
  const pending =
    sessionStorage.getItem(POST_SETUP_AWAIT_GITHUB_KEY) === "1" &&
    statusCache &&
    !statusCache.authenticated &&
    (statusCache.missing?.length ?? 0) === 0;
  if (pending) {
    window.location.href = "/auth/github";
    return;
  }
  startSync();
});
uploadLinkedinZipBtn.addEventListener("click", handleLinkedinUpload);

/** Which sidebar href pathname should appear active for the current URL (includes tab aliases). */
function sidebarLinkMatchesPath(linkPathname, currentPathname) {
  if (linkPathname === currentPathname) return true;
  if (
    linkPathname === "/data/portfolio" &&
    ["/data/repos", "/data/projects", "/data/portfolio"].includes(currentPathname)
  ) {
    return true;
  }
  if (
    linkPathname === "/data/education" &&
    ["/data/education", "/data/certifications", "/data/publications"].includes(currentPathname)
  ) {
    return true;
  }
  if (
    linkPathname === "/data/skills" &&
    ["/data/skills", "/data/developer-tech-stacks", "/data/architectures"].includes(currentPathname)
  ) {
    return true;
  }
  if (
    linkPathname === "/data/endorsements" &&
    ["/data/endorsements", "/data/recommendations"].includes(currentPathname)
  ) {
    return true;
  }
  return false;
}

function syncSidebarActiveFromPath() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const currentPath = window.location.pathname || "/";
  const links = sidebar.querySelectorAll(".side-menu a[href]");
  for (const a of links) {
    let linkPath;
    try {
      linkPath = new URL(a.getAttribute("href"), window.location.origin).pathname;
    } catch {
      continue;
    }
    const li = a.closest("li");
    const active = sidebarLinkMatchesPath(linkPath, currentPath);
    if (li) li.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

window.addEventListener("popstate", () => {
  refreshStatus();
});

refreshStatus();

