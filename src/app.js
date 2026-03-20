require('dotenv').config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const express = require('express');
const multer = require('multer');
const session = require("express-session");
const crypto = require("crypto");
const syncGithub = require('./jobs/syncGithub');
const aggregatePortfolioLanguages = require('./jobs/aggregatePortfolioLanguages');
const detectTechStacks = require('./jobs/detectTechStacks');
const detectDeveloperArchitectures = require('./jobs/detectDeveloperArchitectures');
const generatePortfolioOutput = require('./jobs/generatePortfolioOutput');
const seedTechDetectorRules = require('./jobs/seedTechDetectorRules');
const progressBus = require('./config/progressBus');
const requireLogin = require('./middleware/requireLogin');
const monitoringRoutes = require('./routes/monitoringRoutes');
const dataRoutes = require('./routes/dataRoutes');
const viewsRoutes = require('./routes/viewsRoutes');
const { commitApiOmit, endorsementApiOmit } = require('./constants/apiResponseOmit');
const {
  startJobRun,
  addJobEvent,
  completeJobRun,
  failJobRun,
} = require('./services/monitoringService');
const {
  writeEnvWithUpdates,
  buildDatabaseUrl,
  missingConfigKeys,
  ensureEnvFromExample,
  readCurrentEnv,
  ENV_PATH,
} = require('./config/runtimeConfig');
const { ensureUploadsDir, UPLOADS_DIR, linkedinExportZipPath } = require('./config/uploadsDir');
const { importLinkedInExport } = require('./services/linkedinImportService');
const { resolveDeveloperFromSession } = require('./services/sessionDeveloperService');
const { getDashboardAnalytics } = require('./services/dashboardAnalyticsService');
const prisma = require('./db/prisma');

const REPO_ROOT = path.join(__dirname, '..');
const DEPLOY_PORTFOLIO_SCRIPT = path.join(REPO_ROOT, 'scripts', 'deployPortfolio.js');

/** Same as `node scripts/deployPortfolio.js` (no --regenerate; portfolio already generated in sync). */
function runDeployPortfolioCli(onProgress) {
  const r = spawnSync(process.execPath, [DEPLOY_PORTFOLIO_SCRIPT], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const combined = [r.stdout, r.stderr].filter(Boolean).join('\n');
  for (const line of combined.split(/\r?\n/)) {
    const t = line.trim();
    if (t) onProgress(t);
  }
  if (r.status !== 0) {
    const msg =
      r.stderr?.trim() ||
      r.stdout?.trim() ||
      `deployPortfolio.js exited with code ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
}

function envFlagTrue(name) {
  const v = String(process.env[name] ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// MVC view layer: render EJS fragments under `src/views/`.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-session-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(express.static('src/web'));
app.use(monitoringRoutes);

// Serve SPA shell for direct browser navigation to `/data/:page` while
// preserving JSON API behavior for fetch/XHR calls on the same paths.
app.get('/data/:page', (req, res, next) => {
  const accept = String(req.headers.accept || '').toLowerCase();
  const secFetchDest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  const wantsHtmlDocument = secFetchDest === 'document' || accept.includes('text/html');
  const explicitlyJson = accept.includes('application/json');
  if (wantsHtmlDocument && !explicitlyJson) {
    return res.sendFile(path.join(__dirname, 'web', 'index.html'));
  }
  return next();
});

app.use(dataRoutes);
app.use('/views', viewsRoutes);

ensureUploadsDir();
app.locals.uploadsDir = UPLOADS_DIR;

const LINKEDIN_ZIP_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

const linkedinZipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    if (!name.endsWith(".zip")) {
      return cb(new Error("Only .zip files are allowed"));
    }
    const mime = (file.mimetype || "").toLowerCase();
    if (mime && !LINKEDIN_ZIP_MIMES.has(mime)) {
      return cb(new Error("Only .zip files are allowed"));
    }
    cb(null, true);
  },
}).single("linkedinZip");

let syncInProgress = false;
let activeRunId = null;
let linkedinImportInProgress = false;
let linkedinImportRunId = null;

function oauthConfigured() {
  const envSnapshot = { ...process.env, ...readCurrentEnv() };
  return Boolean(envSnapshot.GITHUB_CLIENT_ID && envSnapshot.GITHUB_CLIENT_SECRET);
}

async function runSyncPipeline(req) {
  if (linkedinImportInProgress) {
    return { started: false, reason: 'linkedin_import_running', runId: linkedinImportRunId };
  }
  if (syncInProgress) return { started: false, reason: 'already_running', runId: activeRunId };

  const runId = `run_${Date.now()}`;
  syncInProgress = true;
  activeRunId = runId;
  progressBus.start(runId, { job: 'sync', label: 'Sync started' });
  const resolved = req ? await resolveDeveloperFromSession(req) : { developer: null, login: null };
  await startJobRun({
    runId,
    jobType: 'sync',
    userLogin: resolved?.login ?? null,
    developerId: resolved?.developer?.id ?? null,
  });
  await addJobEvent({ runId, label: "Sync started", payload: { job: "sync" } });

  const onProgress = (label, extra) => {
    progressBus.publish(label, extra);
    addJobEvent({ runId, label, payload: extra ?? null }).catch(() => {});
  };

  (async () => {
    try {
      const syncResult = await syncGithub({ onProgress });
      const developerId = syncResult?.developerId ?? null;
      if (developerId != null) {
        await aggregatePortfolioLanguages({ developerId, onProgress });
      }
      await detectTechStacks({ onProgress });
      await detectDeveloperArchitectures({ branch: "main", onProgress });
      if (developerId != null) {
        await generatePortfolioOutput({ developerId, onProgress });
        if (envFlagTrue('DEPLOY_PORTFOLIO_AFTER_SYNC')) {
          try {
            runDeployPortfolioCli(onProgress);
          } catch (deployErr) {
            const msg = deployErr?.message ?? String(deployErr);
            onProgress('Portfolio deploy failed', { error: msg });
            await addJobEvent({
              runId,
              label: 'Portfolio deploy failed',
              payload: { message: msg },
            }).catch(() => {});
          }
        }
      }
      if (req?.session) {
        req.session.wizardStep = "upload";
        await new Promise((resolve) => req.session.save(() => resolve()));
      }
      progressBus.finish(true);
      await completeJobRun({ runId, summary: 'Sync pipeline complete' });
    } catch (err) {
      progressBus.finish(false, err?.message ?? String(err));
      await failJobRun({
        runId,
        message: err?.message ?? String(err),
        details: err?.response?.data ?? null,
        stack: err?.stack ?? null,
      });
    } finally {
      syncInProgress = false;
    }
  })();

  return { started: true, runId };
}

// --- Prisma eager-load shapes (avoid runaway recursion) ---
// Developer detail (used by: /developers and /developers/:id)
const developerIdentitySelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  mobileNumber: true,
  headline: true,
  summary: true,
  linkedinSummary: true,
};

const developerDetailInclude = {
  // Repo-level “allied” data for deep inspection.
  repos: {
    include: {
      commits: { omit: commitApiOmit },
      languages: true,
      repoTechStacks: { orderBy: { score: 'desc' } },
    },
  },
  // Developer intelligence tables.
  developerTechStack: true,
  developerArchitectures: {
    include: {
      architecture: true,
    },
  },
  certifications: { orderBy: { sortOrder: 'asc' } },
  developerExperiences: { orderBy: { sortOrder: 'asc' } },
  educations: { orderBy: { sortOrder: 'asc' } },
  projects: {
    orderBy: { sortOrder: 'asc' },
    include: {
       projectLanguages: { include: { language: true } },
    },
  },
  developerLinkedinSkills: { orderBy: { sortOrder: 'asc' } },
  developerLinkedinReceivedEndorsements: {
    orderBy: { sortOrder: 'asc' },
    omit: endorsementApiOmit,
  },
  developerRecommendations: { orderBy: { sortOrder: 'asc' } },
  developerPublications: { orderBy: { sortOrder: 'asc' } },
};

// Developer intelligence when embedded under Repo (avoid developer->repos recursion).
const developerIntelligenceInclude = {
  developerTechStack: true,
  developerArchitectures: {
    include: {
      architecture: true,
    },
  },
};

const architectureWithDevelopersInclude = {
  developerArchitectures: {
    include: {
      developer: {
        select: developerIdentitySelect,
      },
    },
  },
};

function respondError(res, status, error, details) {
  res.status(status).json({ error, status, details });
}

function parseIntParam(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function parseLimitOffset(req) {
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;

  const limit =
    limitRaw === undefined ? 50 : Number(limitRaw);
  const offset =
    offsetRaw === undefined ? 0 : Number(offsetRaw);

  if (!Number.isInteger(limit) || limit < 0) return { error: 'Invalid `limit`' };
  if (!Number.isInteger(offset) || offset < 0) return { error: 'Invalid `offset`' };

  // Keep list responses bounded.
  return { limit: Math.min(limit, 200), offset };
}

app.get('/auth/me', (req, res) => {
  res.json({
    authenticated: Boolean(req.session?.user),
    user: req.session?.user ?? null,
  });
});

app.get('/profile/me', requireLogin, async (req, res) => {
  try {
    const login = req.session?.user?.login;
    const emailFromSession = req.session?.user?.email;
    const emailFallback = login ? `${login}@users.noreply.github.com` : null;
    const email = emailFromSession ?? emailFallback;

    if (!email) return respondError(res, 400, 'Missing profile email', 'Unable to derive email from session');

    let developer = null;
    try {
      developer = await prisma.developer.findUnique({
        where: { email },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          mobileNumber: true,
          headline: true,
          summary: true,
          linkedinSummary: true,
          profilePic: true,
          jobTitle: true,
          hireable: true,
        },
      });
    } catch {
      // If the DB migration hasn't been applied yet, the new columns may not exist.
      developer = await prisma.developer.findUnique({
        where: { email },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          mobileNumber: true,
          headline: true,
          summary: true,
        },
      });
    }

    return res.json({
      email,
      login,
      avatarUrl: developer?.profilePic ?? req.session?.user?.avatarUrl ?? null,
      phoneNumber: developer?.mobileNumber ?? null,
      jobTitle: developer?.jobTitle ?? null,
      hireable: developer?.hireable ?? null,
      firstName: developer?.firstName ?? null,
      lastName: developer?.lastName ?? null,
      headline: developer?.headline ?? null,
      summary: developer?.summary ?? null,
      linkedinSummary: developer?.linkedinSummary ?? null,
      hasDeveloper: Boolean(developer),
    });
  } catch (err) {
    return respondError(res, 500, 'Profile lookup failed', err?.message ?? String(err));
  }
});

app.get('/dashboard/stats', requireLogin, async (req, res) => {
  try {
    const resolved = await resolveDeveloperFromSession(req);
    if (!resolved.email) {
      return respondError(res, 400, 'Missing profile email', 'Unable to derive email from session');
    }
    const devId = resolved.developer?.id ?? null;
    if (devId == null) {
      return res.json({
        developers: 0,
        repos: 0,
        commits: 0,
        architectures: 0,
        developerTechStacks: 0,
        developerArchitectures: 0,
        monitoring: {
          runningJobs: 0,
          failures24h: 0,
          lastSyncStatus: null,
          lastImportStatus: null,
        },
      });
    }

    const jobWhere = { developerId: devId };
    const [
      reposCount,
      commitsCount,
      architectureCatalogCount,
      developerTechStacksCount,
      developerArchitecturesCount,
      runningJobsCount,
      failures24hCount,
      lastSync,
      lastLinkedin,
    ] = await Promise.all([
      prisma.repo.count({ where: { developerId: devId } }),
      prisma.commit.count({ where: { repo: { developerId: devId } } }),
      prisma.architecture.count(),
      prisma.developerTechStack.count({ where: { developerId: devId } }),
      prisma.developerArchitecture.count({ where: { developerId: devId } }),
      prisma.jobRun.count({ where: { ...jobWhere, status: 'running' } }),
      prisma.jobFailure.count({
        where: {
          occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          run: { developerId: devId },
        },
      }),
      prisma.jobRun.findFirst({
        where: { ...jobWhere, jobType: 'sync' },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.jobRun.findFirst({
        where: { ...jobWhere, jobType: 'linkedin' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return res.json({
      developers: 1,
      repos: reposCount,
      commits: commitsCount,
      architectures: architectureCatalogCount,
      developerTechStacks: developerTechStacksCount,
      developerArchitectures: developerArchitecturesCount,
      monitoring: {
        runningJobs: runningJobsCount,
        failures24h: failures24hCount,
        lastSyncStatus: lastSync?.status ?? null,
        lastImportStatus: lastLinkedin?.status ?? null,
      },
    });
  } catch (err) {
    return respondError(res, 500, 'Dashboard stats failed', err?.message ?? String(err));
  }
});

app.get('/dashboard/analytics', requireLogin, async (req, res) => {
  try {
    const resolved = await resolveDeveloperFromSession(req);
    if (!resolved.email) {
      return respondError(res, 400, 'Missing profile email', 'Unable to derive email from session');
    }
    if (!resolved.developer) {
      return respondError(res, 404, 'No developer record', 'Run GitHub sync first');
    }
    const data = await getDashboardAnalytics(resolved.developer.id);
    return res.json(data);
  } catch (err) {
    return respondError(res, 500, 'Dashboard analytics failed', err?.message ?? String(err));
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/auth/github', (req, res) => {
  const envSnapshot = { ...process.env, ...readCurrentEnv() };
  const clientId = envSnapshot.GITHUB_CLIENT_ID;
  if (!clientId) return respondError(res, 400, 'Missing config', 'GITHUB_CLIENT_ID is not configured');

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const callbackUrl = envSnapshot.GITHUB_OAUTH_CALLBACK_URL || `${req.protocol}://${req.get('host')}/auth/github/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/github/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return respondError(res, 400, 'Invalid OAuth state', 'State mismatch or missing code');
    }

    const envSnapshot = { ...process.env, ...readCurrentEnv() };
    const clientId = envSnapshot.GITHUB_CLIENT_ID;
    const clientSecret = envSnapshot.GITHUB_CLIENT_SECRET;
    const callbackUrl = envSnapshot.GITHUB_OAUTH_CALLBACK_URL || `${req.protocol}://${req.get('host')}/auth/github/callback`;
    if (!clientId || !clientSecret) {
      return respondError(res, 400, 'Missing config', 'GITHUB OAuth credentials are not configured');
    }

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        redirect_uri: callbackUrl,
        state: String(state),
      }),
    });
    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return respondError(res, 400, 'OAuth token exchange failed', tokenJson);
    }

    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const userJson = await userResp.json();

    // `read:user user:email` allows retrieving verified/primary emails for stable developer lookup.
    const emailsResp = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const emailsJson = await emailsResp.json().catch(() => []);
    const emailFromGitHub =
      emailsJson?.find((e) => e?.primary === true && e?.verified === true)?.email ??
      emailsJson?.find((e) => e?.verified === true)?.email ??
      emailsJson?.find((e) => e?.primary === true)?.email ??
      null;

    const emailFallback = userJson?.login ? `${userJson.login}@users.noreply.github.com` : null;
    const email = emailFromGitHub ?? emailFallback;
    req.session.user = {
      id: userJson.id,
      login: userJson.login,
      name: userJson.name,
      avatarUrl: userJson.avatar_url,
      email,
    };
    delete req.session.oauthState;
    res.redirect('/dashboard');
  } catch (err) {
    respondError(res, 500, 'OAuth callback failed', err?.message ?? String(err));
  }
});

app.get('/setup/status', async (req, res) => {
  // First-run convenience: bootstrap `.env` from `.example.env` if missing.
  const envExistsBefore = fs.existsSync(ENV_PATH);
  ensureEnvFromExample();
  const envExistsNow = fs.existsSync(ENV_PATH);
  const envSnapshot = { ...process.env, ...readCurrentEnv() };
  const missing = missingConfigKeys(envSnapshot);
  const authConfigured = oauthConfigured();
  let wizardStep = "setup";
  let syncCompleted = false;
  let linkedinCompleted = false;
  if (missing.length === 0) {
    if (!req.session?.user) {
      wizardStep = "login";
    } else if (req.session?.wizardStep === "upload") {
      wizardStep = "upload";
    } else {
      wizardStep = "sync";
    }
  }

  // Persisted wizard logic based on completed job runs.
  // This lets the UI stop showing the syncing card once GitHub sync is done,
  // and lets users re-upload LinkedIn later.
  try {
    if (missing.length === 0 && req.session?.user) {
      const currentLogin = req.session?.user?.login ?? null;
      const [lastSync, lastLinkedin] = await Promise.all([
        prisma.jobRun.findFirst({
          where: {
            jobType: "sync",
            ...(currentLogin ? { userLogin: currentLogin } : {}),
          },
          orderBy: { startedAt: "desc" },
        }),
        prisma.jobRun.findFirst({
          where: {
            jobType: "linkedin",
            ...(currentLogin ? { userLogin: currentLogin } : {}),
          },
          orderBy: { startedAt: "desc" },
        }),
      ]);

      syncCompleted = lastSync?.status === "completed";
      linkedinCompleted = lastLinkedin?.status === "completed";

      if (syncCompleted && linkedinCompleted) wizardStep = "ready";
      else if (syncCompleted && !linkedinCompleted) wizardStep = "upload";
      else if (!syncCompleted) wizardStep = "sync";
    }
  } catch {
    // If DB inspection fails, fall back to the session-derived wizardStep.
  }
  res.json({
    authenticated: Boolean(req.session?.user),
    user: req.session?.user ?? null,
    authConfigured,
    wizardStep,
    syncCompleted,
    linkedinCompleted,
    envExists: envExistsNow,
    envBootstrapped: !envExistsBefore && envExistsNow,
    missing,
    needsSetup: missing.length > 0,
    syncInProgress,
    linkedinImportInProgress,
    runId: activeRunId,
    linkedinImportRunId,
  });
});

app.post('/setup/submit', async (req, res) => {
  try {
    const {
      port,
      githubToken,
      githubUsername,
      githubClientId,
      githubClientSecret,
      dbHost,
      dbPort,
      dbUser,
      dbPassword,
      dbName,
    } = req.body ?? {};

    const databaseUrl = buildDatabaseUrl({ dbHost, dbPort, dbUser, dbPassword, dbName });
    const generatedSessionSecret = crypto.randomBytes(32).toString("hex");
    const updates = {
      PORT: String(port ?? "").trim(),
      GITHUB_TOKEN: String(githubToken ?? "").trim(),
      GITHUB_USERNAME: String(githubUsername ?? "").trim(),
      GITHUB_CLIENT_ID: String(githubClientId ?? "").trim(),
      GITHUB_CLIENT_SECRET: String(githubClientSecret ?? "").trim(),
      SESSION_SECRET: generatedSessionSecret,
      DATABASE_URL: databaseUrl,
    };

    const requiredKeys = Object.entries(updates).filter(([, value]) => !String(value).trim()).map(([key]) => key);
    if (requiredKeys.length > 0) {
      return respondError(res, 400, 'Invalid setup input', { missing: requiredKeys });
    }

    writeEnvWithUpdates(updates);
    res.json({
      ok: true,
      restartRequired: false,
      message: 'Setup saved. Redirecting to GitHub authentication.',
      nextAuthUrl: '/auth/github',
    });
  } catch (err) {
    respondError(res, 500, 'Setup failed', err?.message ?? String(err));
  }
});

app.post('/sync/start', requireLogin, async (req, res) => {
  const started = await runSyncPipeline(req);
  if (!started.started) {
    const details =
      started.reason === 'linkedin_import_running'
        ? 'LinkedIn import is still running'
        : 'A sync is already running';
    return respondError(res, 409, 'Busy', { runId: started.runId, reason: started.reason, details });
  }
  res.json({ ok: true, runId: started.runId });
});

app.get('/sync/progress', requireLogin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  for (const ev of progressBus.lastEvents) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  const unsubscribe = progressBus.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});

app.post('/upload/linkedin', requireLogin, (req, res) => {
  linkedinZipUpload(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return respondError(res, 413, "File too large", "Maximum upload size is 150 MB");
      }
      return respondError(res, 400, "Upload failed", err.message ?? String(err));
    }
    if (!req.file?.buffer) {
      return respondError(res, 400, "No file", "Select a LinkedIn export ZIP file");
    }

    if (syncInProgress) {
      return respondError(res, 409, "Busy", "GitHub sync is running; wait for it to finish");
    }
    if (linkedinImportInProgress) {
      return respondError(res, 409, "Busy", "LinkedIn import is already running");
    }

    try {
      ensureUploadsDir();
      const { login, email, developer } = await resolveDeveloperFromSession(req);
      if (!email) {
        return respondError(res, 400, "Missing profile email", "Unable to derive email from session");
      }
      if (!developer) {
        return respondError(
          res,
          404,
          "No developer record",
          "Run GitHub sync first so a developer profile exists for this account",
        );
      }

      const runId = `linkedin_${Date.now()}`;
      linkedinImportInProgress = true;
      linkedinImportRunId = runId;
      progressBus.start(runId, { job: "linkedin", label: "LinkedIn import started" });
      await startJobRun({
        runId,
        jobType: "linkedin",
        userLogin: login ?? null,
        developerId: developer.id,
      });
      await addJobEvent({ runId, label: "LinkedIn import started", payload: { job: "linkedin" } });

      const fileBuffer = req.file.buffer;
      const developerId = developer.id;
      const originalName = req.file.originalname;
      const fileSize = req.file.size;
      const dest = linkedinExportZipPath(developerId);

      res.json({
        ok: true,
        runId,
        started: true,
        originalName,
        size: fileSize,
        filename: path.basename(dest),
      });

      const onProgress = (label, extra = {}) => {
        progressBus.publish(label, { job: "linkedin", ...extra });
        addJobEvent({ runId, label, payload: extra }).catch(() => {});
      };

      (async () => {
        try {
          onProgress("LinkedIn: saving ZIP to disk", { phase: "save" });
          fs.writeFileSync(dest, fileBuffer);
          const importResult = await importLinkedInExport({
            zipPath: dest,
            developerId,
            onProgress,
          });
          onProgress("LinkedIn: aggregating portfolio languages from GitHub repos", {
            phase: "aggregate",
          });
          await aggregatePortfolioLanguages({ developerId, onProgress });
          progressBus.finish(true, null, {
            job: "linkedin",
            import: importResult.stats,
            filename: path.basename(dest),
          });
          await completeJobRun({
            runId,
            summary: "LinkedIn import complete",
            metadata: importResult.stats,
          });
        } catch (importErr) {
          progressBus.finish(false, importErr?.message ?? String(importErr), { job: "linkedin" });
          await failJobRun({
            runId,
            message: importErr?.message ?? String(importErr),
            details: importErr?.response?.data ?? null,
            stack: importErr?.stack ?? null,
          });
        } finally {
          linkedinImportInProgress = false;
          linkedinImportRunId = null;
        }
      })();
    } catch (uploadErr) {
      return respondError(
        res,
        500,
        "LinkedIn upload failed",
        uploadErr?.message ?? String(uploadErr),
      );
    }
  });
});

// Trigger sync manually
app.get('/sync', async (req, res) => {
  try {
    const started = await runSyncPipeline(req);
    if (!started.started) {
      return res.json({ status: 'Sync already running', runId: started.runId });
    }
    res.json({ status: 'Sync started', runId: started.runId });
  } catch (err) {
    const status = err?.response?.status ?? 500;
    const details = err?.response?.data ?? err?.message ?? String(err);
    res.status(status).json({
      error: 'GitHub sync failed',
      status,
      details,
    });
  }
});

// Get repos
app.get('/repos', async (req, res) => {
  const repos = await prisma.repo.findMany({
    include: {
      commits: { omit: commitApiOmit },
      languages: true,
      repoTechStacks: { orderBy: { score: 'desc' } },
      developer: {
        include: developerIntelligenceInclude,
      },
    },
  });

  res.json(repos);
});

// Developers
app.get('/developers', async (req, res) => {
  const parsed = parseLimitOffset(req);
  if (parsed.error) {
    return respondError(res, 400, 'Invalid query parameters', { details: parsed.error });
  }

  try {
    const developers = await prisma.developer.findMany({
      take: parsed.limit,
      skip: parsed.offset,
      orderBy: { id: 'asc' },
      include: developerDetailInclude,
    });
    res.json(developers);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch developers',
      err?.message ?? String(err),
    );
  }
});

app.get('/developers/by-email/:email', async (req, res) => {
  const email = String(req.params.email ?? '').trim();
  if (!email) return respondError(res, 400, 'Invalid parameter', { param: 'email' });

  try {
    const developer = await prisma.developer.findUnique({
      where: { email },
      include: developerDetailInclude,
    });
    if (!developer) return respondError(res, 404, 'Not found', { email });
    res.json(developer);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch developer',
      err?.message ?? String(err),
    );
  }
});

app.get('/developers/:id/repos', async (req, res) => {
  const developerId = parseIntParam(req.params.id);
  if (developerId == null) {
    return respondError(res, 400, 'Invalid parameter', { param: 'id', value: req.params.id });
  }

  try {
    const developerExists = await prisma.developer.findUnique({
      where: { id: developerId },
      select: { id: true },
    });
    if (!developerExists) return respondError(res, 404, 'Not found', { id: developerId });

    const repos = await prisma.repo.findMany({
      where: { developerId },
      include: {
        commits: { omit: commitApiOmit },
        languages: true,
        repoTechStacks: { orderBy: { score: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(repos);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch developer repositories',
      err?.message ?? String(err),
    );
  }
});

app.get('/developers/:id/tech-stacks', async (req, res) => {
  const developerId = parseIntParam(req.params.id);
  if (developerId == null) {
    return respondError(res, 400, 'Invalid parameter', { param: 'id', value: req.params.id });
  }

  try {
    const developerExists = await prisma.developer.findUnique({
      where: { id: developerId },
      select: { id: true },
    });
    if (!developerExists) return respondError(res, 404, 'Not found', { id: developerId });

    const techStacks = await prisma.developerTechStack.findMany({
      where: { developerId },
      orderBy: { percentage: 'desc' },
    });
    res.json(techStacks);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch developer tech stacks',
      err?.message ?? String(err),
    );
  }
});

app.get('/developers/:id/architectures', async (req, res) => {
  const developerId = parseIntParam(req.params.id);
  if (developerId == null) {
    return respondError(res, 400, 'Invalid parameter', { param: 'id', value: req.params.id });
  }

  try {
    const developerExists = await prisma.developer.findUnique({
      where: { id: developerId },
      select: { id: true },
    });
    if (!developerExists) return respondError(res, 404, 'Not found', { id: developerId });

    const architectures = await prisma.developerArchitecture.findMany({
      where: { developerId },
      include: { architecture: true },
      orderBy: { count: 'desc' },
    });
    res.json(architectures);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch developer architectures',
      err?.message ?? String(err),
    );
  }
});

app.get('/developers/:id', async (req, res) => {
  const id = parseIntParam(req.params.id);
  if (id == null) {
    return respondError(res, 400, 'Invalid parameter', { param: 'id', value: req.params.id });
  }

  try {
    const developer = await prisma.developer.findUnique({
      where: { id },
      include: developerDetailInclude,
    });
    if (!developer) return respondError(res, 404, 'Not found', { id });
    res.json(developer);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch developer',
      err?.message ?? String(err),
    );
  }
});

// Repos (detail)
app.get('/repos/:repoId', async (req, res) => {
  const repoId = String(req.params.repoId ?? '').trim();
  if (!repoId) return respondError(res, 400, 'Invalid parameter', { param: 'repoId' });

  try {
    const repo = await prisma.repo.findUnique({
      where: { id: repoId },
      include: {
        commits: { omit: commitApiOmit },
        languages: true,
        repoTechStacks: { orderBy: { score: 'desc' } },
        developer: { include: developerIntelligenceInclude },
      },
    });
    if (!repo) return respondError(res, 404, 'Not found', { repoId });
    res.json(repo);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch repo',
      err?.message ?? String(err),
    );
  }
});

// Architectures
app.get('/architectures', async (req, res) => {
  try {
    const architectures = await prisma.architecture.findMany({
      include: architectureWithDevelopersInclude,
      orderBy: { count: 'desc' },
    });
    res.json(architectures);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch architectures',
      err?.message ?? String(err),
    );
  }
});

app.get('/architectures/:name', async (req, res) => {
  const name = String(req.params.name ?? '').trim();
  if (!name) return respondError(res, 400, 'Invalid parameter', { param: 'name' });

  try {
    const architecture = await prisma.architecture.findUnique({
      where: { name },
      include: architectureWithDevelopersInclude,
    });
    if (!architecture) return respondError(res, 404, 'Not found', { name });
    res.json(architecture);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch architecture',
      err?.message ?? String(err),
    );
  }
});

// Tech detector rules
app.get('/tech-detector-rules', async (req, res) => {
  try {
    const rules = await prisma.techDetectorRule.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(rules);
  } catch (err) {
    respondError(
      res,
      500,
      'Failed to fetch tech detector rules',
      err?.message ?? String(err),
    );
  }
});

// Detect per-developer tech stacks from repo file contents + saved languages.
app.get('/detect-tech-stacks', async (req, res) => {
  try {
    await detectTechStacks();
    res.json({ status: "Tech stacks detected" });
  } catch (err) {
    const status = err?.response?.status ?? 500;
    const details = err?.response?.data ?? err?.message ?? String(err);
    res.status(status).json({
      error: 'Tech stack detection failed',
      status,
      details,
    });
  }
});

// Detect per-developer architectures from repo metadata + file list
app.get('/detect-architectures', async (req, res) => {
  try {
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    await detectDeveloperArchitectures({ branch: branch ?? "main" });
    res.json({ status: "Developer architectures detected" });
  } catch (err) {
    const status = err?.response?.status ?? 500;
    const details = err?.response?.data ?? err?.message ?? String(err);
    res.status(status).json({
      error: 'Architecture detection failed',
      status,
      details,
    });
  }
});

// Commit exposure removed: keep commits stored in DB, but do not serve `/data/commits`.
app.get('/data/commits', (req, res) => {
  const accept = String(req.headers.accept || '').toLowerCase();
  const wantsJson = accept.includes('application/json');
  if (wantsJson) return res.status(404).json({ error: 'Not found' });
  return res.status(404).send('Not found');
});

app.get(['/dashboard', '/profile', '/data/:page', '/monitoring'], (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

const port = Number(process.env.PORT) || 3000;

async function startServer() {
  // Seed detector rules once at startup (only if table is empty).
  // This keeps `GET /tech-detector-rules` meaningful without requiring env-driven seeding.
  try {
    const count = await prisma.techDetectorRule.count();
    if (count === 0) {
      await seedTechDetectorRules();
    }
  } catch (err) {
    console.error('Tech detector rule seeding failed:', err?.message ?? String(err));
  }

  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  server.on('error', (err) => {
    console.error('HTTP server error:', err);
  });

  server.on('close', () => {
    console.warn('HTTP server closed');
  });
}

startServer();