-- Per-developer GitHub PAT for API sync (encrypted application-side).
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "github_pat_enc" TEXT;
