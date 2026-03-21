-- Per-developer portfolio deploy repo URL (overrides server DEPLOY_REPO_URL when set).
ALTER TABLE "developers" ADD COLUMN "deploy_repo_url" TEXT;
