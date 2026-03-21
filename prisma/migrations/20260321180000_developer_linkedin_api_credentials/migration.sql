-- Per-developer LinkedIn API fields (ACCESS_TOKEN, PERSON_ID legacy env names — see schema comments).

ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "linkedin_access_token_enc" TEXT;
ALTER TABLE "developers" ADD COLUMN IF NOT EXISTS "linkedin_person_id" TEXT;
