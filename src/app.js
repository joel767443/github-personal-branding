require('dotenv').config();
const fs = require("fs");
const path = require("path");
const express = require('express');
const multer = require('multer');
const session = require("express-session");
const crypto = require("crypto");
const { executeSyncPipeline } = require('./jobs/syncPipeline');
const seedTechDetectorRules = require('./jobs/seedTechDetectorRules');
const progressBus = require('./config/progressBus');
const requireLogin = require('./middleware/requireLogin');
const monitoringRoutes = require('./routes/monitoringRoutes');
const dataRoutes = require('./routes/dataRoutes');
const viewsRoutes = require('./routes/viewsRoutes');
const apiV1Routes = require('./routes/apiV1Routes');
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
  mergedEnv,
  ENV_PATH,
  ensureSessionSecret,
} = require('./config/runtimeConfig');
ensureSessionSecret();
const { ensureUploadsDir, UPLOADS_DIR, linkedinExportZipPath } = require('./config/uploadsDir');
const { executeLinkedinImportPipeline } = require('./jobs/linkedinPipeline');
const { resolveDeveloperFromSession } = require('./services/sessionDeveloperService');
const { getDashboardAnalytics } = require('./services/dashboardAnalyticsService');
const prisma = require('./db/prisma');
const {
  resolveGithubOAuthAppCredentials,
  isGithubOAuthConfigured,
  resolveGithubOAuthClientSecretFromEnv,
} = require('./services/githubOauthAppCredentials');
const { encryptField } = require('./crypto/fieldEncryption');
const { assertCanRunPaidJobs } = require('./services/subscriptionAccess');
const { syncQueue, linkedinQueue, queuesEnabled } = require('./queue/jobQueues');
const { registerWorkers } = require('./workers/registerWorkers');
const stripeService = require('./services/stripeService');
const { parseSyncFrequency } = require('./services/syncFrequencyHelpers');
const {
  resolveFacebookOAuthRedirectUri,
  facebookGraphApiVersion,
  resolveFacebookOAuthScopes,
} = require('./services/facebookOAuth');
const { respondError } = require('./utils/httpErrors');
const { sanitizeDeveloperForClient } = require('./utils/developerApiSanitize');

function envFlagTrue(name) {
  const v = String(process.env[name] ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

const app = express();
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const stripe = stripeService.getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) {
      return res.status(500).send('Stripe webhook not configured');
    }
    try {
      const sig = req.headers['stripe-signature'];
      const event = stripe.webhooks.constructEvent(req.body, sig, secret);
      await stripeService.handleSubscriptionWebhook(event);
      res.json({ received: true });
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err?.message ?? err}`);
    }
  },
);
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
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}
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
app.use('/api/v1', apiV1Routes);
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

async function runSyncPipeline(req) {
  if (linkedinImportInProgress) {
    return { started: false, reason: 'linkedin_import_running', runId: linkedinImportRunId };
  }
  const resolved = req ? await resolveDeveloperFromSession(req) : { developer: null, login: null };
  const developerId = resolved?.developer?.id ?? null;
  try {
    await assertCanRunPaidJobs(developerId);
  } catch (subErr) {
    return {
      started: false,
      reason: 'subscription',
      message: subErr?.message ?? String(subErr),
    };
  }

  if (queuesEnabled()) {
    const runId = `run_${Date.now()}`;
    activeRunId = runId;
    await startJobRun({
      runId,
      jobType: 'sync',
      userLogin: resolved?.login ?? null,
      developerId,
    });
    await addJobEvent({ runId, label: 'Sync started', payload: { job: 'sync', queued: true } });
    await syncQueue.add(
      'sync',
      {
        runId,
        developerId,
        userLogin: resolved?.login ?? null,
      },
      { jobId: runId },
    );
    return { started: true, runId, queued: true };
  }

  if (syncInProgress) return { started: false, reason: 'already_running', runId: activeRunId };

  const runId = `run_${Date.now()}`;
  syncInProgress = true;
  activeRunId = runId;
  progressBus.start(runId, { job: 'sync', label: 'Sync started' });
  await startJobRun({
    runId,
    jobType: 'sync',
    userLogin: resolved?.login ?? null,
    developerId,
  });
  await addJobEvent({ runId, label: 'Sync started', payload: { job: 'sync' } });

  const onProgress = (label, extra) => {
    progressBus.publish(label, extra);
    addJobEvent({ runId, label, payload: extra ?? null }).catch(() => {});
  };

  (async () => {
    try {
      await executeSyncPipeline({
        developerId,
        onProgress,
        req,
      });
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

app.get('/auth/github', async (req, res) => {
  try {
    req.session.oauthDeveloperId = req.session?.user?.developerId ?? null;
    const creds = await resolveGithubOAuthAppCredentials(req);
    if (!creds.clientId) {
      return res.redirect(302, 'https://github.com/login/oauth/authorize');
    }

    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    // Token exchange must use the same redirect_uri string GitHub saw on authorize (byte-for-byte).
    req.session.oauthGithubRedirectUri = creds.callbackUrl;
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', creds.callbackUrl);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  } catch (err) {
    respondError(res, 500, 'OAuth start failed', err?.message ?? String(err));
  }
});

app.get('/auth/github/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return respondError(res, 400, 'Invalid OAuth state', 'State mismatch or missing code');
    }

    const creds = await resolveGithubOAuthAppCredentials(req);

    if (!creds.clientId || !creds.clientSecret) {
      return respondError(res, 400, 'Missing config', 'GitHub OAuth client id and client secret are required');
    }

    const redirectUri = req.session.oauthGithubRedirectUri ?? creds.callbackUrl;

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: String(code),
        redirect_uri: redirectUri,
        state: String(state),
      }),
    });
    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      if (tokenJson.error === 'incorrect_client_credentials') {
        return respondError(res, 400, 'OAuth token exchange failed', {
          ...tokenJson,
          hint:
            'Use the OAuth App Client ID and Client secret from GitHub → Settings → Developer settings → OAuth Apps (not a GitHub App’s credentials). They must be from the same app. Regenerate the client secret if unsure. A personal access token (ghp_...) cannot be used as the client secret.',
        });
      }
      if (tokenJson.error === 'redirect_uri_mismatch') {
        return respondError(res, 400, 'OAuth token exchange failed', {
          ...tokenJson,
          hint:
            'The redirect URL sent to GitHub must match your OAuth App’s Authorization callback URL and stay identical between /auth/github and the token request. Set GITHUB_OAUTH_CALLBACK_URL to that exact URL if you use a custom host or proxy.',
        });
      }
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
    if (!email) {
      return respondError(res, 400, 'No email', 'GitHub did not return an email for this account');
    }

    let developer = await prisma.developer.findUnique({ where: { email } });
    const nameParts = typeof userJson.name === 'string' ? userJson.name.split(' ').filter(Boolean) : [];
    const firstName = nameParts[0] ?? userJson.login ?? null;
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

    if (!developer) {
      developer = await prisma.developer.create({
        data: {
          email,
          firstName,
          lastName,
          profilePic: userJson.avatar_url ?? null,
          githubLogin: userJson.login,
          githubUsername: userJson.login,
          subscriptionStatus: 'trialing',
        },
      });
      await prisma.developerSocialIntegration.createMany({
        data: ['FACEBOOK', 'TWITTER', 'LINKEDIN'].map((platform) => ({
          developerId: developer.id,
          platform,
          enabled: false,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.developer.update({
      where: { id: developer.id },
      data: {
        githubLogin: userJson.login,
        githubUsername: userJson.login,
        profilePic: userJson.avatar_url ?? null,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
      },
    });

    const m = mergedEnv();
    const envClientId = String(m.GITHUB_CLIENT_ID ?? '').trim();
    const envClientSecret = resolveGithubOAuthClientSecretFromEnv(m);
    if (envClientId && envClientSecret && creds.clientId === envClientId) {
      const existingOauth = await prisma.developer.findUnique({
        where: { id: developer.id },
        select: { githubOauthClientId: true },
      });
      if (!existingOauth?.githubOauthClientId) {
        await prisma.developer.update({
          where: { id: developer.id },
          data: {
            githubOauthClientId: envClientId,
            githubOauthClientSecretEnc: encryptField(envClientSecret),
          },
        });
      }
    }

    req.session.user = {
      id: userJson.id,
      login: userJson.login,
      name: userJson.name,
      avatarUrl: userJson.avatar_url,
      email,
      developerId: developer.id,
    };
    delete req.session.oauthState;
    delete req.session.oauthGithubRedirectUri;
    res.redirect('/dashboard');
  } catch (err) {
    respondError(res, 500, 'OAuth callback failed', err?.message ?? String(err));
  }
});

app.get('/auth/facebook', async (req, res) => {
  try {
    const rawDevId = req.session?.user?.developerId;
    const developerId = rawDevId != null ? Number(rawDevId) : NaN;
    if (!Number.isFinite(developerId) || developerId <= 0) {
      return res.redirect(302, '/?facebook=login_required');
    }
    const appId = String(process.env.FACEBOOK_APP_ID ?? '').trim();
    const appSecret = String(process.env.FACEBOOK_APP_SECRET ?? '').trim();
    if (!appId || !appSecret) {
      return res.redirect(302, '/dashboard?facebook_error=config');
    }
    const graphV = facebookGraphApiVersion();
    const redirectUri = resolveFacebookOAuthRedirectUri(req);
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthFacebookState = state;
    req.session.oauthFacebookRedirectUri = redirectUri;
    const url = new URL(`https://www.facebook.com/${graphV}/dialog/oauth`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', resolveFacebookOAuthScopes());
    res.redirect(302, url.toString());
  } catch (err) {
    respondError(res, 500, 'Facebook OAuth start failed', err?.message ?? String(err));
  }
});

app.get('/auth/facebook/callback', async (req, res) => {
  const logFb = (msg, extra = {}) => {
    console.error('[facebook-oauth]', msg, extra);
  };
  const fail = (code) => {
    logFb('callback failed', { code: String(code).slice(0, 200) });
    return res.redirect(302, `/dashboard?facebook_error=${encodeURIComponent(code)}`);
  };
  try {
    const { code, state, error, error_reason: _errorReason, error_description: errorDescription } = req.query;
    if (error) {
      const msg = errorDescription ? `${String(error)}: ${String(errorDescription)}` : String(error);
      return res.redirect(302, `/dashboard?facebook_error=${encodeURIComponent(msg.slice(0, 200))}`);
    }
    if (!code || !state || state !== req.session.oauthFacebookState) {
      return fail('state');
    }
    const rawDevId = req.session?.user?.developerId;
    const developerId = rawDevId != null ? Number(rawDevId) : NaN;
    if (!Number.isFinite(developerId) || developerId <= 0) {
      return fail('session');
    }
    const redirectUri = req.session.oauthFacebookRedirectUri ?? resolveFacebookOAuthRedirectUri(req);
    delete req.session.oauthFacebookState;
    delete req.session.oauthFacebookRedirectUri;

    const appId = String(process.env.FACEBOOK_APP_ID ?? '').trim();
    const appSecret = String(process.env.FACEBOOK_APP_SECRET ?? '').trim();
    if (!appId || !appSecret) {
      return fail('config');
    }

    const graphV = facebookGraphApiVersion();
    const tokenUrl = new URL(`https://graph.facebook.com/${graphV}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('code', String(code));

    const tokenResp = await fetch(tokenUrl.toString());
    const tokenJson = await tokenResp.json();
    let userAccessToken = tokenJson.access_token;
    if (!userAccessToken) {
      const hint = tokenJson.error?.message || tokenJson.error?.type || tokenJson.error_description;
      return fail(hint ? `token:${String(hint).slice(0, 100)}` : 'token');
    }

    const longLivedUrl = new URL(`https://graph.facebook.com/${graphV}/oauth/access_token`);
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', appId);
    longLivedUrl.searchParams.set('client_secret', appSecret);
    longLivedUrl.searchParams.set('fb_exchange_token', userAccessToken);
    const llResp = await fetch(longLivedUrl.toString());
    const llJson = await llResp.json();
    if (llJson.error) {
      logFb('long-lived token exchange warning', { err: llJson.error });
    }
    if (llJson.access_token) {
      userAccessToken = llJson.access_token;
    }

    /** @type {{ id?: string, name?: string, access_token?: string, tasks?: string[] }[]} */
    let pages = [];
    let nextUrl = `https://graph.facebook.com/${graphV}/me/accounts?fields=id,name,access_token,tasks&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
    for (let pageFetch = 0; pageFetch < 10 && nextUrl; pageFetch += 1) {
      const accResp = await fetch(nextUrl);
      const accJson = await accResp.json();
      if (accJson.error) {
        const em = accJson.error.message || accJson.error.type || 'graph_error';
        return fail(`accounts:${String(em).slice(0, 100)}`);
      }
      if (Array.isArray(accJson.data)) {
        pages = pages.concat(accJson.data);
      }
      nextUrl = accJson.paging?.next || null;
    }

    logFb('/me/accounts pages', { count: pages.length, developerId });
    const hasManage = (tasks) =>
      Array.isArray(tasks) &&
      (tasks.includes('MANAGE') || tasks.includes('CREATE_CONTENT') || tasks.includes('MODERATE'));
    const pickPage =
      pages.find((p) => p?.access_token && hasManage(p.tasks)) ||
      pages.find((p) => p?.access_token) ||
      null;
    if (!pickPage?.access_token && pages.length > 0) {
      logFb('pages without access_token field', {
        pageIds: pages.map((p) => p.id).slice(0, 10),
      });
      return fail(
        'no_page_token: Meta returned Pages but no page access_token. Re-check app permissions and Page admin role.',
      );
    }
    if (!pickPage?.access_token) {
      return fail(
        'no_pages: No Facebook Pages returned for this account. Create a Page at facebook.com/pages/create or ask a Page admin to add you, then try again.',
      );
    }

    const pageTokenEnc = encryptField(pickPage.access_token);
    const pageId = String(pickPage.id ?? '').trim();
    if (!pageId || !pageTokenEnc) {
      return fail('page');
    }

    await prisma.developerFacebookAuthData.upsert({
      where: { developerId },
      create: {
        developerId,
        facebookPageId: pageId,
        pageAccessTokenEnc: pageTokenEnc,
      },
      update: {
        facebookPageId: pageId,
        pageAccessTokenEnc: pageTokenEnc,
      },
    });

    await prisma.developerSocialIntegration.upsert({
      where: {
        developerId_platform: { developerId, platform: 'FACEBOOK' },
      },
      create: {
        developerId,
        platform: 'FACEBOOK',
        enabled: true,
      },
      update: { enabled: true },
    });

    logFb('saved developer_facebook_auth_data', { developerId, facebookPageId: pageId });
    return res.redirect(302, '/dashboard?facebook=connected');
  } catch (err) {
    console.error('[facebook-oauth] exception', err);
    return fail(String(err?.message ?? err).slice(0, 120) || 'exception');
  }
});

app.get('/api/settings/developer', requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    if (!developer) {
      return respondError(res, 404, 'No developer record', 'Sign in with GitHub or email to create a developer profile first');
    }
    const full = await prisma.developer.findUnique({
      where: { id: developer.id },
      include: {
        socialIntegrations: { orderBy: { platform: 'asc' } },
        developerFacebookAuthData: true,
      },
    });
    res.json({ ok: true, developer: sanitizeDeveloperForClient(full) });
  } catch (err) {
    respondError(res, 500, 'Settings load failed', err?.message ?? String(err));
  }
});

app.patch('/api/settings/developer', requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    if (!developer) {
      return respondError(res, 404, 'No developer record', 'Sign in with GitHub or email to create a developer profile first');
    }
    const body = req.body ?? {};
    const data = {};
    if (body.syncFrequency != null) {
      data.syncFrequency = parseSyncFrequency(body.syncFrequency);
    }
    const deployRepoRaw = body.deployRepoUrl ?? body.deploy_repo_url;
    if (deployRepoRaw !== undefined) {
      const u = String(deployRepoRaw ?? '').trim();
      data.deployRepoUrl = u || null;
    }
    if (body.githubOauthClientId !== undefined) {
      data.githubOauthClientId =
        body.githubOauthClientId == null || String(body.githubOauthClientId).trim() === ''
          ? null
          : String(body.githubOauthClientId).trim();
    }
    if (body.clearGithubOauthClientSecret === true) {
      data.githubOauthClientSecretEnc = null;
    } else if (body.githubOauthClientSecret !== undefined) {
      const s = String(body.githubOauthClientSecret ?? '');
      if (s.trim()) {
        data.githubOauthClientSecretEnc = encryptField(s);
      }
    }
    if (body.socialIntegrations && typeof body.socialIntegrations === 'object') {
      for (const [key, enabled] of Object.entries(body.socialIntegrations)) {
        const platform = String(key).toUpperCase();
        if (!['FACEBOOK', 'TWITTER', 'LINKEDIN'].includes(platform)) continue;
        await prisma.developerSocialIntegration.upsert({
          where: {
            developerId_platform: { developerId: developer.id, platform },
          },
          create: {
            developerId: developer.id,
            platform,
            enabled: Boolean(enabled),
          },
          update: { enabled: Boolean(enabled) },
        });
      }
    }
    if (body.accessToken !== undefined) {
      const t = String(body.accessToken ?? '').trim();
      if (t) {
        data.linkedinAccessTokenEnc = encryptField(t);
      }
    }
    if (body.personId !== undefined) {
      const p = String(body.personId ?? '').trim();
      data.linkedinPersonId = p || null;
    }
    if (body.githubPat !== undefined) {
      const g = String(body.githubPat ?? '');
      if (g.trim()) {
        data.githubPatEnc = encryptField(g);
      }
    }
    if (Object.keys(data).length) {
      await prisma.developer.update({ where: { id: developer.id }, data });
    }
    const full = await prisma.developer.findUnique({
      where: { id: developer.id },
      include: { socialIntegrations: true, developerFacebookAuthData: true },
    });
    res.json({ ok: true, developer: sanitizeDeveloperForClient(full) });
  } catch (err) {
    respondError(res, 500, 'Settings update failed', err?.message ?? String(err));
  }
});

app.post('/api/billing/checkout', requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    if (!developer) {
      return respondError(res, 404, 'No developer record', 'Create a profile first');
    }
    const email = req.session?.user?.email;
    if (!email) return respondError(res, 400, 'Missing email', '');
    const { url } = await stripeService.createCheckoutSessionForDeveloper(developer.id, email);
    res.json({ ok: true, url });
  } catch (err) {
    respondError(res, 500, 'Checkout failed', err?.message ?? String(err));
  }
});

app.post('/api/billing/portal', requireLogin, async (req, res) => {
  try {
    const { developer } = await resolveDeveloperFromSession(req);
    if (!developer) {
      return respondError(res, 404, 'No developer record', '');
    }
    const { url } = await stripeService.createBillingPortalSession(developer.id);
    res.json({ ok: true, url });
  } catch (err) {
    respondError(res, 500, 'Portal failed', err?.message ?? String(err));
  }
});

app.get('/setup/status', async (req, res) => {
  // First-run convenience: bootstrap `.env` from `.example.env` if missing.
  const envExistsBefore = fs.existsSync(ENV_PATH);
  ensureEnvFromExample();
  const envExistsNow = fs.existsSync(ENV_PATH);
  const envSnapshot = { ...process.env, ...readCurrentEnv() };
  const missing = missingConfigKeys(envSnapshot);
  const authConfigured = await isGithubOAuthConfigured(req);
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

  let credentialFlags = {
    hasGithubToken: false,
    hasAccessToken: false,
    hasPersonId: false,
  };
  let needsDeveloperCredentials = false;
  let needsLinkedInCredentials = false;
  try {
    if (missing.length === 0 && req.session?.user) {
      const resolved = await resolveDeveloperFromSession(req);
      if (resolved.developer) {
        const row = await prisma.developer.findUnique({
          where: { id: resolved.developer.id },
          select: {
            linkedinAccessTokenEnc: true,
            linkedinPersonId: true,
            githubPatEnc: true,
          },
        });
        const githubFromEnv = Boolean(String(envSnapshot.GITHUB_TOKEN ?? '').trim());
        const githubFromRow = Boolean(row?.githubPatEnc);
        credentialFlags = {
          hasGithubToken: githubFromEnv || githubFromRow,
          hasAccessToken: Boolean(row?.linkedinAccessTokenEnc),
          hasPersonId: Boolean(row?.linkedinPersonId && String(row.linkedinPersonId).trim()),
        };
        needsDeveloperCredentials = !credentialFlags.hasGithubToken;
        needsLinkedInCredentials =
          credentialFlags.hasGithubToken &&
          (!credentialFlags.hasAccessToken || !credentialFlags.hasPersonId);
      }
    }
  } catch {
    needsDeveloperCredentials = false;
    needsLinkedInCredentials = false;
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
    credentialFlags,
    needsDeveloperCredentials,
    needsLinkedInCredentials,
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
    if (started.reason === 'subscription') {
      return respondError(res, 402, 'Subscription required', started.message ?? 'Payment required');
    }
    const details =
      started.reason === 'linkedin_import_running'
        ? 'LinkedIn import is still running'
        : started.reason === 'already_running'
          ? 'A sync is already running'
          : 'Unable to start sync';
    return respondError(res, 409, 'Busy', { runId: started.runId, reason: started.reason, details });
  }
  res.json({ ok: true, runId: started.runId, queued: Boolean(started.queued) });
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

    if (!queuesEnabled() && syncInProgress) {
      return respondError(res, 409, "Busy", "GitHub sync is running; wait for it to finish");
    }
    if (!queuesEnabled() && linkedinImportInProgress) {
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

      try {
        await assertCanRunPaidJobs(developer.id);
      } catch (subErr) {
        return respondError(res, 402, "Subscription required", subErr?.message ?? String(subErr));
      }

      const runId = `linkedin_${Date.now()}`;
      const fileBuffer = req.file.buffer;
      const developerId = developer.id;
      const originalName = req.file.originalname;
      const fileSize = req.file.size;
      const dest = linkedinExportZipPath(developerId);

      fs.writeFileSync(dest, fileBuffer);

      if (queuesEnabled()) {
        linkedinImportRunId = runId;
        await startJobRun({
          runId,
          jobType: "linkedin",
          userLogin: login ?? null,
          developerId,
        });
        await addJobEvent({ runId, label: "LinkedIn import queued", payload: { job: "linkedin" } });
        await linkedinQueue.add(
          "linkedin",
          { runId, developerId, zipPath: dest },
          { jobId: runId },
        );
        return res.json({
          ok: true,
          runId,
          started: true,
          queued: true,
          originalName,
          size: fileSize,
          filename: path.basename(dest),
        });
      }

      linkedinImportInProgress = true;
      linkedinImportRunId = runId;
      progressBus.start(runId, { job: "linkedin", label: "LinkedIn import started" });
      await startJobRun({
        runId,
        jobType: "linkedin",
        userLogin: login ?? null,
        developerId,
      });
      await addJobEvent({ runId, label: "LinkedIn import started", payload: { job: "linkedin" } });

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
          const importResult = await executeLinkedinImportPipeline({
            zipPath: dest,
            developerId,
            onProgress,
          });
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

// Trigger sync manually (legacy GET; prefer POST /sync/start)
app.get('/sync', requireLogin, async (req, res) => {
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
  // This keeps `GET /api/v1/tech-detector-rules` meaningful without requiring env-driven seeding.
  try {
    const count = await prisma.techDetectorRule.count();
    if (count === 0) {
      await seedTechDetectorRules();
    }
  } catch (err) {
    console.error('Tech detector rule seeding failed:', err?.message ?? String(err));
  }

  registerWorkers();

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