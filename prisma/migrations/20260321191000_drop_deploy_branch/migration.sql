-- Removed per-developer deploy_branch; portfolio deploy and sync use default branch `main`.

ALTER TABLE "developers" DROP COLUMN IF EXISTS "deploy_branch";
