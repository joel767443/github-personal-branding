# GitHub Intel Service

A Node.js app that syncs **GitHub** activity into **PostgreSQL**, enriches it with **tech-stack** and **architecture** detection, imports **LinkedIn** exports, and generates a **static portfolio** (README, HTML, assets) you can deploy to a GitHub profile repo. It exposes a **dashboard** (Express + EJS + a small SPA shell) and **monitoring** hooks for long-running jobs.

## Features

- **GitHub OAuth** login and **server `GITHUB_TOKEN`** API sync (repos, languages, commits metadata)
- **Developer profile** storage with Prisma ORM (PostgreSQL)
- **Tech stack** and **architecture** detection from repo contents
- **LinkedIn** data import from an official export ZIP
- **Portfolio output** under `./portfolio` (Markdown README, `index.html`, charts)
- Optional **post-sync deploy** of `./portfolio` to a separate Git repo (e.g. profile README) via `scripts/deployPortfolio.js`

## Requirements

- **Node.js** 18+ (recommended)
- **PostgreSQL** reachable via `DATABASE_URL`
- A **GitHub OAuth App** (Client ID + secret) for login and **`GITHUB_TOKEN`** (PAT) in the server environment for sync jobs
- **Git** (for portfolio deploy)

## Setup

```bash
npm install
cp .example.env .env
```

Edit `.env` with real values (see below). **Never commit `.env`** or paste database URLs into tracked files.

Apply migrations and generate the Prisma client:

```bash
npx prisma migrate deploy
npx prisma generate
```

Start the server:

```bash
npm start
```

The app listens on `PORT` (default **3000**). Open the dashboard at `/dashboard` after signing in with GitHub.

For local development you can use `npx prisma migrate dev` instead of `migrate deploy`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_TOKEN` | Personal access token for GitHub API (sync jobs); server-wide, not per user |

**`SESSION_SECRET`:** one secret for the entire server (Express signs all users’ cookies with it). It is **not** per developer. Set it in the process environment, secret manager, or via Initial Setup — not as one row per user in the database.

**GitHub OAuth (optional “Login with GitHub”):** set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the process environment or your host’s secret manager — they are intentionally omitted from `.example.env`. Optional: `GITHUB_OAUTH_CALLBACK_URL` (defaults to `{origin}/auth/github/callback`).

Per-developer data is stored on `developers` (see Prisma model comments): `githubUsername` / `githubLogin`, optional BYO OAuth app fields (`githubOauthClientId`, `githubOauthClientSecretEnc`), and **portfolio deploy target URL** in **`deploy_repo_url`** (set in the dashboard as “Deploy repo URL”). After each sync, portfolio deploy runs automatically when a deploy repo URL is configured (see deploy script behavior). **GitHub API access for sync jobs** uses `GITHUB_TOKEN` in the **server** environment (not stored per developer). Optional server `DEPLOY_REPO_URL` can still override for a process when set; otherwise deploy reads `deploy_repo_url` from the database.

**Portfolio deploy CLI** (manual runs only):

| Variable | Purpose |
|----------|---------|
| `PORTFOLIO_DEVELOPER_ID` | Which `developers` row to use for deploy / regen when multiple exist; pairs with that row’s `deploy_repo_url` if `DEPLOY_REPO_URL` is unset |

When the app runs deploy after sync, it passes each developer’s deploy settings (including `deploy_repo_url` as `DEPLOY_REPO_URL` when set) into the deploy script as process env (not from `.env`).

See `.example.env` for placeholders.

### Facebook (optional)

Automated posts use the **Graph API Page feed** only (`POST /{page-id}/feed`). You must connect a **Facebook Page** you manage (OAuth loads `/me/accounts` and stores a Page token). Meta does **not** allow apps to post to **personal profile** timelines via the standard Graph API.

**Typical env:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, optional `FACEBOOK_OAUTH_CALLBACK_URL`, optional `FACEBOOK_OAUTH_SCOPES` (default `pages_show_list` in code). Background jobs need Redis: `REDIS_URL`. Sample post: `npm run sample-facebook-post` (requires a row in `developer_facebook_auth_data` after a successful Page connect).

For sharing to your **own** timeline without API posting, use the dashboard link that opens Facebook’s sharer (manual).

### X (Twitter) (optional)

OAuth 2.0 with PKCE connects a developer’s **X account** for **user-context** API calls. Set **`TWITTER_CLIENT_ID`** and **`TWITTER_CLIENT_SECRET`** from the X Developer Portal (OAuth 2.0 client). Optional: **`TWITTER_OAUTH_CALLBACK_URL`** (defaults to `{origin}/auth/twitter/callback`), **`TWITTER_OAUTH_SCOPES`** (defaults to `tweet.read tweet.write users.read offline.access`).

Register the same callback URL in the X app settings. Posting requires your X project/access tier to allow **`tweet.write`** (check current X API pricing and rules).

Background jobs use the same Redis queue as other social posts. Sample: `npm run sample-twitter-post` (requires a row in `developer_twitter_auth_data` after **Connect X** in the dashboard).

## npm scripts

| Script | Command |
|--------|---------|
| `npm run deploy-portfolio` | Push generated `./portfolio` (uses `developers.deploy_repo_url` when `DEPLOY_REPO_URL` is unset) |
| `npm run deploy-portfolio:regen` | Regenerate portfolio from DB, then deploy |
| `npm run sample-facebook-post` | Enqueue a sample **Facebook Page** post (needs Redis + Page OAuth data) |
| `npm run sample-twitter-post` | Enqueue a sample **X** tweet (needs Redis + Twitter OAuth data) |
| `npm run push:origin` | `git push origin HEAD` (this app’s source repo) |

## Repository layout

| Path | Role |
|------|------|
| `src/app.js` | Express app entry |
| `src/routes/` | JSON API and view routes |
| `src/jobs/` | Sync, detection, portfolio generation |
| `src/web/` | Static dashboard shell (HTML/CSS/JS) |
| `src/views/` | EJS partials for server-rendered fragments |
| `prisma/` | Schema and SQL migrations |
| `scripts/deployPortfolio.js` | Clone, copy `./portfolio`, commit, push |
| `portfolio/` | Generated output (often gitignored except when publishing) |

## Security

- Keep secrets in **`.env`** only (listed in `.gitignore`).
- Rotate any credential that was ever committed or exposed (including in comments).

## License

ISC (see `package.json`).
