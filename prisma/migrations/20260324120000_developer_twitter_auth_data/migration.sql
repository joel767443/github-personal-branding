-- X (Twitter) OAuth 2.0 tokens per developer.
CREATE TABLE "developer_twitter_auth_data" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "twitter_user_id" TEXT NOT NULL,
    "twitter_username" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "last_posted_at" TIMESTAMP(3),

    CONSTRAINT "developer_twitter_auth_data_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "developer_twitter_auth_data_developer_id_key" ON "developer_twitter_auth_data"("developer_id");

ALTER TABLE "developer_twitter_auth_data" ADD CONSTRAINT "developer_twitter_auth_data_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
