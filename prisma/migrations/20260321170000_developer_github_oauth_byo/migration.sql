-- Optional per-developer GitHub OAuth app (BYO), when credentials are not in server env.
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "github_oauth_client_id" TEXT;
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "github_oauth_client_secret_enc" TEXT;
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "github_oauth_callback_url" TEXT;
