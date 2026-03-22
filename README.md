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

The app listens on `PORT` (default **80**; set `PORT=3000` for local dev if you cannot bind to 80). Open the dashboard at `/dashboard` after signing in with GitHub. For HTTPS OAuth callbacks in production, set **`PUBLIC_BASE_URL`** (e.g. `https://yourdomain.com`) or **`TWITTER_OAUTH_CALLBACK_URL`** to the full `https://.../auth/twitter/callback` URL.

This process serves **HTTP only**. If you use **`https://dev-sync.com`** in the browser, you need TLS on port 443 (e.g. **mkcert + Caddy**). See **[docs/local-dev-https.md](docs/local-dev-https.md)** and **[Caddyfile.example](Caddyfile.example)**. Until then, use **`http://dev-sync.com`** (and matching `http://` OAuth callback URLs), or you will see `ERR_CONNECTION_REFUSED` on port 443.

For local development you can use `npx prisma migrate dev` instead of `migrate deploy`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `80`; use `PORT=3000` or similar for local dev if binding to 80 fails) |
| `PUBLIC_BASE_URL` | Optional public site origin for OAuth redirects, e.g. `https://yourdomain.com` (no trailing slash). Used for X callback when `TWITTER_OAUTH_CALLBACK_URL` is unset. |
| `FORCE_HTTPS` | If `1` or `true`, OAuth redirect URIs built from the request use `https://` (use behind TLS termination with `TRUST_PROXY`). |
| `TRUST_PROXY` | Set `1` or `true` when the app sits behind a reverse proxy so `req.protocol` and client IP are correct. |
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_TOKEN` | Personal access token for GitHub API (sync jobs); server-wide, not per user |

**`SESSION_SECRET`:** one secret for the entire server (Express signs all users’ cookies with it). It is **not** per developer. Set it in the process environment, secret manager, or via Initial Setup — not as one row per user in the database.

**GitHub OAuth (optional “Login with GitHub”):** set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the process environment or your host’s secret manager — they are intentionally omitted from `.example.env`. Callback URL resolution: optional **`GITHUB_OAUTH_CALLBACK_URL`** (must match the OAuth App’s **Authorization callback URL** in GitHub exactly); else **`PUBLIC_BASE_URL`** + `/auth/github/callback`; else `{protocol}://{host}/auth/github/callback` (set **`TRUST_PROXY=1`** and **`FORCE_HTTPS=1`** behind TLS termination). If GitHub shows *“The redirect_uri is not associated with this application”*, the registered callback and the URL your server sends differ — set `DEBUG_GITHUB_OAUTH=1`, click login once, and copy the logged `redirect_uri` into [GitHub → OAuth App → Authorization callback URL](https://github.com/settings/developers).

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

OAuth 2.0 with PKCE connects a developer’s **X account** for **user-context** API calls. Set **`TWITTER_CONSUMER_KEY`** and **`TWITTER_CONSUMER_SECRET`** (same values as **API Key** and **API Key Secret** in the X Developer Portal; OAuth 2.0 **Client ID** / **Client Secret** use these). Legacy names **`TWITTER_CLIENT_ID`** / **`TWITTER_CLIENT_SECRET`** are still accepted as fallbacks.

**HTTPS callback URLs:** Prefer **`PUBLIC_BASE_URL`** (e.g. `https://yourdomain.com`, no trailing slash) so the redirect URI is always `https://yourdomain.com/auth/twitter/callback`. Alternatively set **`TWITTER_OAUTH_CALLBACK_URL`** to that full URL. If you terminate TLS in front of Node, set **`TRUST_PROXY=1`** (or `true`) and **`FORCE_HTTPS=1`** so the app builds `https://...` when `PUBLIC_BASE_URL` is unset. Optional: **`TWITTER_OAUTH_SCOPES`** (defaults to `tweet.read tweet.write users.read offline.access`).

**Callback URL must match exactly.** In the [X Developer Portal](https://developer.x.com), open your app → **User authentication settings** → enable **OAuth 2.0** → under **Callback URI / Redirect URL**, add the **same** URL your server uses (same scheme `http` vs `https`, host, path, no extra trailing slash). It must match what [`resolveTwitterOAuthRedirectUri`](src/social/twitter/oauth/config.js) produces: `TWITTER_OAUTH_CALLBACK_URL`, or `PUBLIC_BASE_URL` + `/auth/twitter/callback`, or `req` host–derived URL. If you see *“The redirect_uri is not associated with this application”*, the portal list and `.env` differ. Set `DEBUG_TWITTER_OAUTH=1` and click **Connect X** once; the server logs the exact `redirect_uri` to paste into the portal.

Posting requires your X project/access tier to allow **`tweet.write`** and **API usage credits** on your developer account. If the API returns *no credits to fulfill this request*, add credits or upgrade access in the [X Developer Portal](https://developer.x.com) (billing / product tier), then retry.

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
