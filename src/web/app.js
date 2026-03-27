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

function applyLinkedinUploadUiVisibility(status) {
  if (!status) return;
  const showSetup = status.wizardStep === "setup";
  const showLogin = status.wizardStep === "login";
  const shouldForceUploadGate =
    Boolean(status.authenticated) &&
    !showSetup &&
    !showLogin &&
    !Boolean(status.needsDeveloperCredentials) &&
    !Boolean(status.linkedinCompleted) &&
    !Boolean(status.linkedinImportInProgress);
  const showUploadCard = !showSetup && !showLogin && (status.wizardStep === "upload" || shouldForceUploadGate);
  const uploadGateRoot = document.getElementById("linkedinUploadGateRoot");
  setHidden(uploadGateRoot, !showUploadCard);
  const needsLi = Boolean(status.needsLinkedInCredentials);
  const linkedinCredentialsSection = document.getElementById("linkedinCredentialsSection");
  if (linkedinCredentialsSection) {
    setHidden(linkedinCredentialsSection, !needsLi || !showUploadCard);
  }
  const linkedinCredentialsMsg = document.getElementById("linkedinCredentialsMsg");
  if (!needsLi && linkedinCredentialsMsg) {
    linkedinCredentialsMsg.textContent = "";
  }
  const uploadLinkedinZipBtn = document.getElementById("uploadLinkedinZipBtn");
  if (uploadLinkedinZipBtn && showUploadCard) {
    uploadLinkedinZipBtn.disabled = Boolean(
      status.syncInProgress || status.linkedinImportInProgress,
    );
  }
}

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userMenuButton = document.getElementById("userMenuButton");
const userMenuDropdown = document.getElementById("userMenuDropdown");
const syncCard = document.getElementById("syncCard");
const syncCardMountPostSetup = document.getElementById("syncCardMountPostSetup");
const syncCardMountProfile = document.getElementById("syncCardMountProfile");
const syncState = document.getElementById("syncState");
const progressLog = document.getElementById("progressLog");
const startSyncBtn = document.getElementById("startSyncBtn");
const pageTitle = document.getElementById("pageTitle");
const sidebarEl = document.getElementById("sidebar");
const topNavEl = document.getElementById("topNav");
const githubTokenGateRoot = document.getElementById("githubTokenGateRoot");
const githubTokenRequiredCard = document.getElementById("githubTokenRequiredCard");
const dashboardCard = document.getElementById("dashboardCard");
const settingsCard = document.getElementById("settingsCard");
const settingsCardMountDefault = document.getElementById("settingsCardMountDefault");
const settingsCardMountProfile = document.getElementById("settingsCardMountProfile");
const syncFrequencySelect = document.getElementById("syncFrequencySelect");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const facebookStatus = document.getElementById("facebookStatus");
const facebookSharePersonalLink = document.getElementById("facebookSharePersonalLink");
const twitterStatus = document.getElementById("twitterStatus");
const btnTwitterDisconnect = document.getElementById("btnTwitterDisconnect");
const socialTwitter = document.getElementById("socialTwitter");
const socialLinkedin = document.getElementById("socialLinkedin");
const btnCheckout = document.getElementById("btnCheckout");
const btnPortal = document.getElementById("btnPortal");
const settingsMsg = document.getElementById("settingsMsg");
const githubPatInput = document.getElementById("githubPatInput");
const btnSaveGithubPat = document.getElementById("btnSaveGithubPat");
const githubPatMsg = document.getElementById("githubPatMsg");
const loginCard = document.getElementById("loginCard");
const serverConfigHint = document.getElementById("serverConfigHint");
const githubLoginBtn = document.getElementById("githubLoginBtn");
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
const statSocialPosts30d = document.getElementById("statSocialPosts30d");
const statLastJobStatus = document.getElementById("statLastJobStatus");
const dataPageCard = document.getElementById("dataPageCard");
const dataPageTitle = document.getElementById("dataPageTitle");
const dataPageSubtitle = document.getElementById("dataPageSubtitle");
const dataPageContent = document.getElementById("dataPageContent");
const POST_SETUP_AWAIT_GITHUB_KEY = "pdbs_await_github_after_setup";
const POST_UPLOAD_DASHBOARD_KEY = "pdbs_show_dashboard_after_upload_start";

let statusCache = null;
let progressSSE = null;
let dashboardLoading = false;
let dataPageLoading = false;
let dashboardRefreshTimer = null;

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

function applyFacebookOAuthFlash() {
  const u = new URL(window.location.href);
  const ok = u.searchParams.get("facebook");
  const err = u.searchParams.get("facebook_error");
  if (ok === "connected" && settingsMsg) {
    settingsMsg.textContent =
      "Facebook Page connected. Automated posts will go to this Page (not your personal profile).";
  } else if (err && settingsMsg) {
    let decoded = err;
    try {
      decoded = decodeURIComponent(String(err).replace(/\+/g, " "));
    } catch {
      decoded = String(err);
    }
    const lower = decoded.toLowerCase();
    if (lower.includes("no_pages") || lower.includes("no facebook pages")) {
      settingsMsg.textContent =
        "Facebook: No Page found. Create a Facebook Page or use an account that manages one, then try Connect again. Personal profiles cannot receive API posts.";
    } else if (lower.includes("no_page_token")) {
      settingsMsg.textContent =
        "Facebook: Pages were returned but Meta did not grant a page token. Check app permissions and your Page role.";
    } else {
      settingsMsg.textContent = `Facebook: ${decoded}`;
    }
  }
  if (ok || err) {
    u.searchParams.delete("facebook");
    u.searchParams.delete("facebook_error");
    const q = u.searchParams.toString();
    window.history.replaceState({}, "", q ? `${u.pathname}?${q}` : u.pathname);
  }
}

function applyTwitterOAuthFlash() {
  const u = new URL(window.location.href);
  const ok = u.searchParams.get("twitter");
  const err = u.searchParams.get("twitter_error");
  if (ok === "connected" && settingsMsg) {
    settingsMsg.textContent = "X (Twitter) connected. Background posts can use your account.";
  } else if (ok === "login_required" && settingsMsg) {
    settingsMsg.textContent = "Sign in first, then connect X (Twitter).";
  } else if (err && settingsMsg) {
    let decoded = err;
    try {
      decoded = decodeURIComponent(String(err).replace(/\+/g, " "));
    } catch {
      decoded = String(err);
    }
    if (String(decoded).toLowerCase().includes("config")) {
      settingsMsg.textContent =
        "X (Twitter): server missing TWITTER_CONSUMER_KEY / TWITTER_CONSUMER_SECRET (or TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET). Set them in the environment.";
    } else {
      settingsMsg.textContent = `X (Twitter): ${decoded}`;
    }
  }
  if (ok || err) {
    u.searchParams.delete("twitter");
    u.searchParams.delete("twitter_error");
    const q = u.searchParams.toString();
    window.history.replaceState({}, "", q ? `${u.pathname}?${q}` : u.pathname);
  }
}

async function loadSettingsForm() {
  if (!syncFrequencySelect) return;
  try {
    applyFacebookOAuthFlash();
    applyTwitterOAuthFlash();
    const data = await getJsonOptional("/api/settings/developer");
    const d = data?.developer;
    if (!d) return;
    syncFrequencySelect.value = d.syncFrequency || "TWO_DAYS";
    const map = { TWITTER: socialTwitter, LINKEDIN: socialLinkedin };
    for (const row of d.socialIntegrations ?? []) {
      const el = map[row.platform];
      if (el) el.checked = Boolean(row.enabled);
    }
    const fb = d.developerFacebookAuthData;
    if (facebookStatus) {
      if (fb?.facebookPageConnected && fb?.facebookPageId) {
        facebookStatus.textContent = `Page connected (ID ${fb.facebookPageId}) — API posts use this Page`;
      } else if (fb?.facebookPageConnected) {
        facebookStatus.textContent = "Page connected — API posts use this Page";
      } else {
        facebookStatus.textContent = "No Page connected for API posting";
      }
    }
    const tw = d.developerTwitterAuthData;
    if (twitterStatus) {
      if (tw?.twitterConnected && tw?.twitterUsername) {
        twitterStatus.textContent = `Connected @${tw.twitterUsername} — API posts use this account`;
      } else if (tw?.twitterConnected && tw?.twitterUserId) {
        twitterStatus.textContent = `Connected (user ${tw.twitterUserId}) — API posts use this account`;
      } else if (tw?.twitterConnected) {
        twitterStatus.textContent = "Connected — API posts use this X account";
      } else {
        twitterStatus.textContent = "Not connected for API posting";
      }
    }
    const deployUrlField = document.getElementById("deployRepoUrlInput");
    if (deployUrlField) deployUrlField.value = d.deployRepoUrl ?? "";
    // Secrets are never returned from the API (only *Configured flags); keep field empty for security.
    if (githubPatInput) githubPatInput.value = "";
  } catch (_) {
    /* ignore */
  }
}

// Delegate to modular managers
async function loadDashboardData() {
  if (dashboardLoading) return;
  dashboardLoading = true;
  try {
    const profile = await ApiClient.getJson("/profile/me");

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

    await DashboardManager.loadAll();
    await loadSettingsForm();

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
    // Keep UI quiet
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

/** Append current page query string to a `/views/...` path (no leading `?` in `path`). */
function viewsUrl(path) {
  const q = window.location.search;
  if (!q) return path;
  const [base, existing] = path.split("?");
  const merged = new URLSearchParams(q);
  if (existing) {
    const extra = new URLSearchParams(existing);
    for (const [k, v] of extra) merged.set(k, v);
  }
  const s = merged.toString();
  return s ? `${base}?${s}` : base;
}

function monitoringTabFromSearch() {
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "health" || t === "failures" || t === "runs") return t;
  return "runs";
}

document.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest?.("button[data-pagination-param][data-pagination-page]");
  if (!btn || btn.disabled) return;
  if (!dataPageContent?.contains(btn)) return;
  const route = currentDataRoute();
  if (!route || route.kind !== "data") return;
  const param = btn.getAttribute("data-pagination-param");
  const p = btn.getAttribute("data-pagination-page");
  if (!param || p == null) return;
  ev.preventDefault();
  const u = new URL(window.location.href);
  u.searchParams.set(param, p);
  if (Number(p) <= 1) u.searchParams.delete(param);
  if (route.page === "portfolio") {
    if (param === "reposPage") u.searchParams.set("tab", "repos");
    if (param === "projectsPage") u.searchParams.set("tab", "projects");
  }
  if (route.page === "skills") {
    if (param === "skillsPage") u.searchParams.set("tab", "skills");
    if (param === "dtsPage") u.searchParams.set("tab", "developer-tech-stacks");
    if (param === "archPage") u.searchParams.set("tab", "architectures");
  }
  if (route.page === "endorsements" && param === "endorsementsPage") {
    u.searchParams.set("tab", "endorsements");
  }
  if (route.page === "endorsements" && param === "recommendationsPage") {
    u.searchParams.set("tab", "recommendations");
  }
  if (route.page === "monitoring") {
    if (param === "runsPage") {
      u.searchParams.set("tab", "runs");
      u.searchParams.delete("runEvents");
      u.searchParams.delete("eventsPage");
    }
    if (param === "failuresPage") {
      u.searchParams.set("tab", "failures");
      u.searchParams.delete("runEvents");
      u.searchParams.delete("eventsPage");
    }
    if (param === "eventsPage") {
      u.searchParams.set("tab", "runs");
    }
  }
  history.pushState(null, "", u.toString());
  syncSidebarActiveFromPath();
  await loadDataPage();
});

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
  if (page === "skills") {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("tab");
    const allowed = new Set(["skills", "developer-tech-stacks", "architectures"]);
    const skillsTab = allowed.has(tab) ? tab : "skills";
    return {
      api: "/data/skills",
      title: "Skills",
      kind: "data",
      page: "skills",
      skillsTab,
    };
  }
  if (page === "developer-tech-stacks" || page === "architectures") {
    return {
      api: "/data/skills",
      title: "Skills",
      kind: "data",
      page: "skills",
      skillsTab: page,
    };
  }
  if (page === "endorsements" || page === "recommendations") {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("tab");
    const normalized = tab === "endorsements" || tab === "recommendations" ? tab : undefined;
    const tabFromPath = page === "recommendations" ? "recommendations" : "endorsements";
    return {
      api: "/data/endorsements",
      title: "Endorsements",
      kind: "data",
      page: "endorsements",
      endorsementsTab: normalized ?? tabFromPath,
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
      await loadSettingsForm();
      if (statusCache) applyLinkedinUploadUiVisibility(statusCache);
    } else if (route?.page === "experience") {
      dataPageContent.innerHTML = await getHtml(viewsUrl("/views/experience"));
    } else if (route?.page === "projects") {
      dataPageContent.innerHTML = await getHtml(viewsUrl("/views/projects"));
    } else if (route?.page === "repos") {
      dataPageContent.innerHTML = await getHtml(viewsUrl("/views/repos"));
    } else if (route?.page === "architectures") {
      dataPageContent.innerHTML = await getHtml(viewsUrl("/views/architectures"));
    } else if (route?.page === "monitoring") {
      const activeTab = monitoringTabFromSearch();
      const shellHtml = await getHtml(
        `/views/monitoring/shell?activeTab=${encodeURIComponent(activeTab)}`,
      );
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
          const qs = window.location.search || "";
          const q = qs.startsWith("?") ? qs.slice(1) : qs;
          if (tab === "health") {
            tabContent.innerHTML = await getHtml("/views/monitoring/health");
          } else if (tab === "failures") {
            tabContent.innerHTML = await getHtml(
              q ? `/views/monitoring/failures?${q}` : "/views/monitoring/failures",
            );
          } else {
            tabContent.innerHTML = await getHtml(
              q ? `/views/monitoring/runs?${q}` : "/views/monitoring/runs",
            );
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
          if (!tab) return;
          const u = new URL(window.location.href);
          u.searchParams.set("tab", tab);
          u.searchParams.delete("runEvents");
          u.searchParams.delete("eventsPage");
          if (tab === "runs") {
            u.searchParams.delete("failuresPage");
          } else if (tab === "failures") {
            u.searchParams.delete("runsPage");
          } else if (tab === "health") {
            u.searchParams.delete("runsPage");
            u.searchParams.delete("failuresPage");
          }
          history.pushState(null, "", u.toString());
          syncSidebarActiveFromPath();
          await loadTab(tab);
          return;
        }

        if (actionBtn) {
          const runId = actionBtn.getAttribute("data-run-id");
          if (!runId) return;
          const u = new URL(window.location.href);
          u.searchParams.set("tab", "runs");
          u.searchParams.set("runEvents", runId);
          u.searchParams.delete("eventsPage");
          history.pushState(null, "", u.toString());
          syncSidebarActiveFromPath();
          setTabActive("runs");
          setLoadingState(tabContent, "Loading events…");
          try {
            const q = new URL(window.location.href).search.slice(1);
            tabContent.innerHTML = await getHtml(
              q
                ? `/views/monitoring/runs/${encodeURIComponent(runId)}/events?${q}`
                : `/views/monitoring/runs/${encodeURIComponent(runId)}/events`,
            );
          } catch (err) {
            setErrorState(tabContent, err?.message || String(err));
          }
        }
      };

      const pageUrl = new URL(window.location.href);
      const runEventsId = pageUrl.searchParams.get("runEvents");
      if (runEventsId && tabContent) {
        setTabActive("runs");
        try {
          const q = pageUrl.search.slice(1);
          tabContent.innerHTML = await getHtml(
            q
              ? `/views/monitoring/runs/${encodeURIComponent(runEventsId)}/events?${q}`
              : `/views/monitoring/runs/${encodeURIComponent(runEventsId)}/events`,
          );
        } catch (err) {
          setErrorState(tabContent, err?.message || String(err));
        }
      } else {
        await loadTab(activeTab);
      }
    } else if (route?.page === "portfolio") {
      const initialTab = route?.portfolioTab ?? "repos";
      const sp = new URLSearchParams(window.location.search);
      sp.set("tab", initialTab);
      dataPageContent.innerHTML = await getHtml(`/views/portfolio?${sp.toString()}`);

      dataPageContent.onclick = async (ev) => {
        const btn = ev.target?.closest?.("button[data-portfolio-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-portfolio-tab");
        if (!tabKey) return;
        const u = new URL(window.location.href);
        u.searchParams.set("tab", tabKey);
        u.searchParams.delete("reposPage");
        u.searchParams.delete("projectsPage");
        history.pushState(null, "", u.toString());
        syncSidebarActiveFromPath();
        await loadDataPage();
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
      const sp = new URLSearchParams(window.location.search);
      sp.set("tab", initialTab);
      dataPageContent.innerHTML = await getHtml(`/views/skills?${sp.toString()}`);

      dataPageContent.onclick = async (ev) => {
        const btn = ev.target?.closest?.("button[data-skills-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-skills-tab");
        if (!tabKey) return;
        const u = new URL(window.location.href);
        u.searchParams.set("tab", tabKey);
        u.searchParams.delete("skillsPage");
        u.searchParams.delete("dtsPage");
        u.searchParams.delete("archPage");
        history.pushState(null, "", u.toString());
        syncSidebarActiveFromPath();
        await loadDataPage();
      };
    } else if (route?.page === "endorsements") {
      const u = new URL(window.location.href);
      let cleaned = false;
      if (u.pathname === "/data/recommendations") {
        u.pathname = "/data/endorsements";
        cleaned = true;
      }
      const activeTab = route?.endorsementsTab === "recommendations" ? "recommendations" : "endorsements";
      if (u.searchParams.get("tab") !== activeTab) {
        u.searchParams.set("tab", activeTab);
        cleaned = true;
      }
      if (cleaned) history.replaceState(null, "", u.toString());

      const sp = new URLSearchParams(window.location.search);
      dataPageContent.innerHTML = await getHtml(`/views/endorsements?${sp.toString()}`);

      dataPageContent.onclick = async (ev) => {
        const btn = ev.target?.closest?.("button[data-endorsements-tab]");
        if (!btn) return;
        const tabKey = btn.getAttribute("data-endorsements-tab");
        if (!tabKey) return;
        const nextTab = tabKey === "recommendations" ? "recommendations" : "endorsements";
        const next = new URL(window.location.href);
        next.searchParams.set("tab", nextTab);
        next.searchParams.delete("endorsementsPage");
        next.searchParams.delete("recommendationsPage");
        history.pushState(null, "", next.toString());
        syncSidebarActiveFromPath();
        await loadDataPage();
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
    const shouldForceUploadGate =
      Boolean(status.authenticated) &&
      !showSetup &&
      !showLogin &&
      !Boolean(status.needsDeveloperCredentials) &&
      !Boolean(status.linkedinCompleted) &&
      !Boolean(status.linkedinImportInProgress);
    const showUploadStep = status.wizardStep === "upload" || shouldForceUploadGate;
    const uploadPipelineStarted =
      sessionStorage.getItem(POST_UPLOAD_DASHBOARD_KEY) === "1" &&
      (status.syncInProgress || status.linkedinImportInProgress);

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
    const showTokenRequiredCard =
      status.authenticated &&
      !showSetup &&
      !showLogin &&
      Boolean(status.needsDeveloperCredentials) &&
      Boolean(route) &&
      (route.kind === "dashboard" || route.kind === "data");
    const showUploadGateExclusive = showUploadStep && !uploadPipelineStarted;
    const showTokenGateExclusive = showTokenRequiredCard || showUploadGateExclusive;

    // Dashboard is only `/dashboard`, never on `/`, setup, login, or other routes.
    const showDashboard =
      status.authenticated &&
      !showSetup &&
      !showLogin &&
      !postSetupAwaitingAuth &&
      (isDashboardRoute || (showUploadStep && uploadPipelineStarted));

    // Hide shell on setup/login/post-setup, and while upload gate is still blocking.
    const hideShell = showSetup || showLogin || postSetupAwaitingAuth || showUploadGateExclusive;
    setHidden(sidebarEl, hideShell);
    setHidden(topNavEl, hideShell);
    setHidden(githubTokenGateRoot, !showTokenGateExclusive);
    setHidden(githubTokenRequiredCard, !showTokenRequiredCard || hideShell);

    const showDataPageCard =
      !postSetupAwaitingAuth && !showSetup && !showLogin && Boolean(route) && route.kind === "data";
    setHidden(dataPageCard, !showDataPageCard || showTokenGateExclusive);

    const showDashboardCard = showDashboard && !postSetupAwaitingAuth;
    setHidden(dashboardCard, !showDashboardCard || showTokenGateExclusive);
    const showSettingsCard = showDataPageCard && isProfilePage && !showTokenGateExclusive;
    setHidden(settingsCard, !showSettingsCard || showTokenGateExclusive);
    if (settingsCard && settingsCardMountDefault && settingsCardMountProfile) {
      if (showSettingsCard) {
        settingsCardMountProfile.appendChild(settingsCard);
      } else {
        settingsCardMountDefault.appendChild(settingsCard);
      }
    }

    pageTitle.textContent = capitalizePageTitle(
      showSetup || showLogin
        ? "Sign in"
        : postSetupAwaitingAuth
          ? "Sync GitHub Data"
          : showUploadGateExclusive
            ? "Upload LinkedIn Export"
          : route
              ? (route.title || "Data")
              : forceUploadUi
                ? "LinkedIn Upload"
                : "PDBS",
    );

    const showAuthCard = (showSetup || showLogin) && !postSetupAwaitingAuth && !showUploadGateExclusive;
    setHidden(loginCard, !showAuthCard || showTokenGateExclusive);
    if (serverConfigHint) {
      if (showSetup && (status.missing?.length ?? 0) > 0) {
        serverConfigHint.textContent = `Server configuration incomplete: ${status.missing.join(", ")}. Set these in your environment or .env file (for example DATABASE_URL and SESSION_SECRET).`;
        setHidden(serverConfigHint, false);
      } else {
        setHidden(serverConfigHint, true);
      }
    }
    // Sync GitHub: on `/profile` during normal flow; on post-setup mount when shell is minimal (before GitHub sign-in).
    const showSyncCard =
      !showTokenGateExclusive && (postSetupAwaitingAuth || (showSync && !forceUploadUi && isProfilePage));
    setHidden(syncCard, !showSyncCard);
    if (syncCard && syncCardMountPostSetup && syncCardMountProfile) {
      if (showSyncCard) {
        if (postSetupAwaitingAuth) {
          syncCardMountPostSetup.appendChild(syncCard);
        } else {
          syncCardMountProfile.appendChild(syncCard);
        }
      } else {
        syncCardMountPostSetup.appendChild(syncCard);
      }
    }
    applyLinkedinUploadUiVisibility(status);

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
    } else if (!showSetup && !status.authenticated) {
      setHidden(userMenuButton, true);
      userMenuDropdown.classList.remove("open");
      setHidden(loginBtn, false);
    } else {
      setHidden(userMenuButton, true);
      setHidden(loginBtn, true);
      userMenuDropdown.classList.remove("open");
    }

    // Don't load dashboard data when forcing upload-only UI.
    if (
      showSetup ||
      !status.authenticated ||
      forceUploadUi ||
      showTokenGateExclusive ||
      (route && route.kind !== "dashboard")
    ) {
      clearDashboard();
    } else {
      loadDashboardData();
    }
    if (
      !showSetup &&
      !showLogin &&
      !showTokenRequiredCard &&
      status.authenticated &&
      route?.kind === "data"
    ) {
      loadDataPage().catch((err) => console.error("loadDataPage failed:", err));
    }

    if (showSetup || showLogin) {
      syncState.textContent = showSetup
        ? "Blocked until server configuration is complete and you are signed in"
        : "Sign in to start sync";
      startSyncBtn.disabled = true;
      if (progressSSE) {
        progressSSE.close();
        progressSSE = null;
      }
    } else if (postSetupAwaitingAuth) {
      syncState.textContent = "Sign in with GitHub to run your first sync.";
      startSyncBtn.disabled = false;
    } else if (!status.authenticated) {
      syncState.textContent = "Login required to start sync";
      startSyncBtn.disabled = true;
    } else if (status.needsDeveloperCredentials) {
      syncState.textContent =
        "Add a GitHub PAT under Account settings, or set GITHUB_TOKEN on the server, to start sync";
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

    syncSidebarActiveFromPath();
  } catch (err) {
    syncState.textContent = `Status failed: ${err.message}`;
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
      const linkedinProgressLog = document.getElementById("linkedinProgressLog");
      const logTarget = job === "linkedin" ? linkedinProgressLog : progressLog;
      addLog(`[${data.at}] ${data.label}`, null, logTarget ?? progressLog);
      if (dashboardRefreshTimer) clearTimeout(dashboardRefreshTimer);
      dashboardRefreshTimer = setTimeout(() => {
        if ((window.location.pathname || "") === "/dashboard") {
          loadDashboardData().catch(() => {});
        }
      }, 500);
      if (data.type === "done") {
        if (job === "linkedin") {
          sessionStorage.removeItem(POST_UPLOAD_DASHBOARD_KEY);
          const uploadStatus = document.getElementById("uploadStatus");
          const uploadLinkedinZipBtn = document.getElementById("uploadLinkedinZipBtn");
          if (uploadStatus) uploadStatus.className = "ok";
          let msg = `Import complete${data.filename ? ` (${data.filename})` : ""}.`;
          if (data.import && typeof data.import === "object") {
            const nonzero = Object.entries(data.import).filter(([, v]) => Number(v) > 0);
            if (nonzero.length) {
              msg += ` ${nonzero.map(([k, v]) => `${k}: ${v}`).join(", ")}.`;
            }
          }
          if (uploadStatus) uploadStatus.textContent = msg;
          if (uploadLinkedinZipBtn) uploadLinkedinZipBtn.disabled = false;
        } else {
          syncState.textContent = "Sync complete";
          startSyncBtn.disabled = false;
        }
        refreshStatus();
      }
      if (data.type === "error") {
        if (job === "linkedin") {
          const uploadStatus = document.getElementById("uploadStatus");
          const uploadLinkedinZipBtn = document.getElementById("uploadLinkedinZipBtn");
          const liLog = document.getElementById("linkedinProgressLog");
          if (uploadStatus) uploadStatus.className = "err";
          if (uploadStatus) uploadStatus.textContent = data.error || "LinkedIn import failed";
          addLog(data.error || "Unknown import error", "error", liLog ?? progressLog);
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
  const linkedinZipInput = document.getElementById("linkedinZip");
  const uploadStatus = document.getElementById("uploadStatus");
  const uploadLinkedinZipBtn = document.getElementById("uploadLinkedinZipBtn");
  const linkedinProgressLog = document.getElementById("linkedinProgressLog");
  if (!uploadStatus || !uploadLinkedinZipBtn) return;
  const file = linkedinZipInput?.files?.[0];
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
    sessionStorage.setItem(POST_UPLOAD_DASHBOARD_KEY, "1");
    uploadStatus.textContent = json.syncRunId
      ? `ZIP received (${kb} KB). LinkedIn import queued${json.runId ? ` — ${json.runId}` : ""}. GitHub repo sync queued${json.syncRunId ? ` — ${json.syncRunId}` : ""}.`
      : `ZIP received (${kb} KB). LinkedIn import started${json.runId ? ` — ${json.runId}` : ""}. GitHub repo sync will start automatically right after LinkedIn import completes.`;
    addLog(`LinkedIn import job queued (${json.runId || "run"})`, "ok", linkedinProgressLog ?? progressLog);
    if (json.syncRunId) {
      addLog(`GitHub sync job queued (${json.syncRunId})`, "ok", linkedinProgressLog ?? progressLog);
    }
    window.history.replaceState(null, "", "/dashboard");
    await refreshStatus();
    await loadDashboardData();
  } catch (err) {
    uploadStatus.className = "err";
    uploadStatus.textContent = err.message || String(err);
    uploadLinkedinZipBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", () => {
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

githubLoginBtn?.addEventListener("click", () => {
  window.location.href = "/auth/github";
});

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
document.addEventListener("click", (ev) => {
  if (ev.target?.closest?.("#uploadLinkedinZipBtn")) {
    ev.preventDefault();
    handleLinkedinUpload();
  }
  if (ev.target?.closest?.("#btnSaveLinkedinCredentials")) {
    ev.preventDefault();
    submitLinkedinCredentials();
  }
});

async function submitLinkedinCredentials() {
  const linkedinCredAccessToken = document.getElementById("linkedinCredAccessToken");
  const linkedinCredPersonId = document.getElementById("linkedinCredPersonId");
  const linkedinCredentialsMsg = document.getElementById("linkedinCredentialsMsg");
  const btnSaveLinkedinCredentials = document.getElementById("btnSaveLinkedinCredentials");
  const at = linkedinCredAccessToken?.value?.trim();
  const pid = linkedinCredPersonId?.value?.trim();
  if (!at) {
    if (linkedinCredentialsMsg) linkedinCredentialsMsg.textContent = "ACCESS_TOKEN is required.";
    return;
  }
  if (!pid) {
    if (linkedinCredentialsMsg) linkedinCredentialsMsg.textContent = "PERSON_ID is required.";
    return;
  }
  if (linkedinCredentialsMsg) linkedinCredentialsMsg.textContent = "Saving…";
  if (btnSaveLinkedinCredentials) btnSaveLinkedinCredentials.disabled = true;
  try {
    await getJson("/api/settings/developer", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: at, personId: pid }),
    });
    if (linkedinCredentialsMsg) linkedinCredentialsMsg.textContent = "Saved.";
    if (linkedinCredAccessToken) linkedinCredAccessToken.value = "";
    if (linkedinCredPersonId) linkedinCredPersonId.value = "";
    await refreshStatus();
  } catch (err) {
    if (linkedinCredentialsMsg) linkedinCredentialsMsg.textContent = err.message || String(err);
  } finally {
    if (btnSaveLinkedinCredentials) btnSaveLinkedinCredentials.disabled = false;
  }
}

async function submitGithubPat() {
  const t = githubPatInput?.value?.trim();
  const deployUrlEl = document.getElementById("deployRepoUrlInput");
  if (!t) {
    if (githubPatMsg) githubPatMsg.textContent = "Enter a GitHub personal access token.";
    return;
  }
  if (githubPatMsg) githubPatMsg.textContent = "Saving…";
  if (btnSaveGithubPat) btnSaveGithubPat.disabled = true;
  try {
    const payload = { githubPat: t };
    if (deployUrlEl) payload.deployRepoUrl = deployUrlEl.value?.trim() ?? "";
    await getJson("/api/settings/developer", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (githubPatMsg) githubPatMsg.textContent = "Saved.";
    if (githubPatInput) githubPatInput.value = "";
    await loadSettingsForm();
    await refreshStatus();
  } catch (err) {
    if (githubPatMsg) githubPatMsg.textContent = err.message || String(err);
  } finally {
    if (btnSaveGithubPat) btnSaveGithubPat.disabled = false;
  }
}

btnSaveGithubPat?.addEventListener("click", () => submitGithubPat());

btnTwitterDisconnect?.addEventListener("click", async () => {
  if (settingsMsg) settingsMsg.textContent = "Disconnecting X…";
  try {
    const r = await fetch("/auth/twitter/disconnect", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText || "Disconnect failed");
    if (settingsMsg) settingsMsg.textContent = "X (Twitter) disconnected.";
    await loadSettingsForm();
  } catch (e) {
    if (settingsMsg) settingsMsg.textContent = e?.message ?? String(e);
  }
});

facebookSharePersonalLink?.addEventListener("click", (e) => {
  e.preventDefault();
  const origin = window.location.origin || "";
  const u = encodeURIComponent(`${origin}/`);
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    "fb_share",
    "width=600,height=440,noopener,noreferrer",
  );
});

saveSettingsBtn?.addEventListener("click", async () => {
  if (!syncFrequencySelect) return;
  if (settingsMsg) settingsMsg.textContent = "Saving…";
  try {
    const deployUrlEl = document.getElementById("deployRepoUrlInput");
    const payload = {
      syncFrequency: syncFrequencySelect.value,
      socialIntegrations: {
        TWITTER: Boolean(socialTwitter?.checked),
        LINKEDIN: Boolean(socialLinkedin?.checked),
      },
    };
    if (deployUrlEl) {
      payload.deployRepoUrl = deployUrlEl.value?.trim() ?? "";
    }
    await getJson("/api/settings/developer", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (settingsMsg) settingsMsg.textContent = "Saved.";
    await loadSettingsForm();
  } catch (err) {
    if (settingsMsg) settingsMsg.textContent = err.message || String(err);
  }
});

btnCheckout?.addEventListener("click", async () => {
  if (settingsMsg) settingsMsg.textContent = "Opening checkout…";
  try {
    const out = await getJson("/api/billing/checkout", { method: "POST" });
    if (out.url) window.location.href = out.url;
  } catch (err) {
    if (settingsMsg) settingsMsg.textContent = err.message || String(err);
  }
});

btnPortal?.addEventListener("click", async () => {
  if (settingsMsg) settingsMsg.textContent = "Opening portal…";
  try {
    const out = await getJson("/api/billing/portal", { method: "POST" });
    if (out.url) window.location.href = out.url;
  } catch (err) {
    if (settingsMsg) settingsMsg.textContent = err.message || String(err);
  }
});

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

