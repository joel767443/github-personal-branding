-- Per-developer git remote label for portfolio deploy (replaces shared DEPLOY_README_REMOTE env).
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "deploy_readme_remote" TEXT NOT NULL DEFAULT 'readme';
