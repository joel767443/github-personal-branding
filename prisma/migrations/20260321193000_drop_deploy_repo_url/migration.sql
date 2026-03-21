-- Per-developer deploy repo URL removed; set DEPLOY_REPO_URL in server environment for portfolio deploy if needed.

ALTER TABLE "developers" DROP COLUMN IF EXISTS "deploy_repo_url";
