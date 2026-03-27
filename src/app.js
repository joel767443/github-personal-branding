require('dotenv').config();
const fs = require("fs");
const path = require("path");
const express = require('express');
const multer = require('multer');
const session = require("express-session");

const { ensureSessionSecret } = require('./config/runtimeConfig');
const { ensureUploadsDir, UPLOADS_DIR } = require('./config/uploadsDir');
const prisma = require('./db/prisma');
const { registerWorkers } = require('./workers/registerWorkers');
const seedTechDetectorRules = require('./jobs/seedTechDetectorRules');
const requireLogin = require('./middleware/requireLogin');

// Controllers
const authController = require('./controllers/AuthController');
const billingController = require('./controllers/BillingController');
const settingsController = require('./controllers/SettingsController');
const syncController = require('./controllers/SyncController');
const systemController = require('./controllers/SystemController');

// Routes
const monitoringRoutes = require('./routes/monitoringRoutes');
const twitterAuthRoutes = require('./routes/twitterAuthRoutes');
const dataRoutes = require('./routes/dataRoutes');
const viewsRoutes = require('./routes/viewsRoutes');
const apiV1Routes = require('./routes/apiV1Routes');

ensureSessionSecret();
ensureUploadsDir();

const app = express();
const port = Number(process.env.PORT) || 80;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }
});

// Middleware
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => billingController.webhook(req, res));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function sessionCookieSecure() {
  const raw = String(process.env.SESSION_COOKIE_SECURE ?? '').toLowerCase().trim();
  if (raw === '0' || raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: sessionCookieSecure(), maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(express.static('src/web'));

// Auth Routes
app.get('/auth/github', (req, res) => authController.githubLogin(req, res));
app.get('/auth/github/callback', (req, res) => authController.githubCallback(req, res));
app.get('/auth/facebook', (req, res) => authController.facebookLogin(req, res));
app.get('/auth/facebook/callback', (req, res) => authController.facebookCallback(req, res));
app.get('/auth/logout', (req, res) => authController.logout(req, res));
app.get('/auth/me', (req, res) => {
  res.json({ authenticated: Boolean(req.session?.user), user: req.session?.user ?? null });
});

app.get('/setup/status', (req, res) => systemController.getStatus(req, res));

const dashboardAnalyticsService = require('./services/dashboardAnalyticsService');

app.get('/dashboard/stats', requireLogin, async (req, res) => {
  const { developer } = await require('./services/sessionDeveloperService').resolveDeveloperFromSession(req);
  const stats = await dashboardAnalyticsService.getDashboardAnalytics(developer?.id);
  res.json(stats.summary);
});

app.get('/dashboard/analytics', requireLogin, async (req, res) => {
  const { developer } = await require('./services/sessionDeveloperService').resolveDeveloperFromSession(req);
  const stats = await dashboardAnalyticsService.getDashboardAnalytics(developer?.id);
  res.json(stats);
});

// SPA Fallback (Document requests only)
app.get(['/dashboard', '/profile', '/monitoring', '/data/:page'], (req, res, next) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'web', 'index.html'));
  }
  next();
});

// Settings & Billing
app.get('/api/settings/developer', requireLogin, settingsController.getSettings.bind(settingsController));
app.patch('/api/settings/developer', requireLogin, settingsController.updateSettings.bind(settingsController));
app.post('/api/billing/checkout', requireLogin, billingController.checkout.bind(billingController));
app.post('/api/billing/portal', requireLogin, billingController.portal.bind(billingController));

// Sync & Upload
app.post('/sync/start', requireLogin, syncController.startSync.bind(syncController));
app.post('/upload/linkedin', requireLogin, upload.single("linkedinZip"), syncController.uploadLinkedin.bind(syncController));

// App Routes
app.use(monitoringRoutes);
app.use(twitterAuthRoutes);
app.use(dataRoutes);
app.use('/api/v1', apiV1Routes);
app.use('/views', viewsRoutes);

const socketService = require('./services/SocketService');

async function startServer() {
  try {
    if (await prisma.techDetectorRule.count() === 0) await seedTechDetectorRules();
  } catch (err) {
    console.error('Seeding failed:', err.message);
  }

  registerWorkers();
  const server = app.listen(port, () => console.log(`Server running on port ${port}`));
  socketService.init(server);
}

startServer();
