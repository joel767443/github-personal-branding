-- Removed per-developer deploy_readme_remote; portfolio deploy uses default remote name `readme` (see scripts/deployPortfolio.js).

ALTER TABLE "developers" DROP COLUMN IF EXISTS "deploy_readme_remote";
