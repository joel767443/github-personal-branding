-- Drop per-developer GitHub OAuth callback override; use server env GITHUB_OAUTH_CALLBACK_URL or request default instead.
ALTER TABLE "developers" DROP COLUMN IF EXISTS "github_oauth_callback_url";
