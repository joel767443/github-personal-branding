# GitHub Intel Service

A Node.js app that syncs **GitHub** activity into **PostgreSQL**, enriches it with **tech-stack** and **architecture** detection, imports **LinkedIn** exports, and generates a **static portfolio** (README, HTML, assets) you can deploy to a GitHub profile repo. It exposes a **dashboard** (Express + EJS + a small SPA shell) and **monitoring** hooks for long-running jobs.

## Features

- **GitHub OAuth** login and **PAT-based** API sync (repos, languages, commits metadata)
- **Developer profile** storage with Prisma ORM (PostgreSQL)
- **Tech stack** and **architecture** detection from repo contents
- **LinkedIn** data import from an official export ZIP
- **Portfolio output** under `./portfolio` (Markdown README, `index.html`, charts)
- Optional **post-sync deploy** of `./portfolio` to a separate Git repo (e.g. profile README) via `scripts/deployPortfolio.js`

## Requirements

- **Node.js** 18+ (recommended)
- **PostgreSQL** reachable via `DATABASE_URL`
- A **GitHub OAuth App** (Client ID + secret) and a **personal access token** for API calls
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
| `GITHUB_TOKEN` | GitHub PAT for API access |
| `GITHUB_USERNAME` | GitHub login used for sync |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth app credentials |
| `SESSION_SECRET` | Express session signing secret |
| `GITHUB_OAUTH_CALLBACK_URL` | Optional; defaults to `{origin}/auth/github/callback` |

**Portfolio deploy** (optional):

| Variable | Purpose |
|----------|---------|
| `DEPLOY_REPO_URL` | Git URL of the target repo (e.g. profile README repo) |
| `DEPLOY_README_REMOTE` | Remote name used in the deploy clone (default `readme`) |
| `DEPLOY_BRANCH` | Branch to push (default `main`) |
| `DEPLOY_PORTFOLIO_AFTER_SYNC` | Set `1` or `true` to run deploy automatically after a successful sync |
| `PORTFOLIO_DEVELOPER_ID` | Developer id when using `deploy-portfolio:regen` CLI |

See `.example.env` for placeholders.

## npm scripts

| Script | Command |
|--------|---------|
| `npm run deploy-portfolio` | Push generated `./portfolio` to `DEPLOY_REPO_URL` |
| `npm run deploy-portfolio:regen` | Regenerate portfolio from DB, then deploy |
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
