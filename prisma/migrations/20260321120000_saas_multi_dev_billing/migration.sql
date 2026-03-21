-- CreateEnum
CREATE TYPE "SyncFrequency" AS ENUM ('TWO_DAYS', 'ONE_WEEK', 'TWO_WEEKS', 'ONE_MONTH');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'TWITTER', 'LINKEDIN');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AlterTable
ALTER TABLE "developers" ADD COLUMN     "user_id" INTEGER,
ADD COLUMN     "github_login" TEXT,
ADD COLUMN     "github_username" TEXT,
ADD COLUMN     "github_access_token_enc" TEXT,
ADD COLUMN     "github_refresh_token_enc" TEXT,
ADD COLUMN     "sync_frequency" "SyncFrequency" NOT NULL DEFAULT 'TWO_DAYS',
ADD COLUMN     "next_scheduled_sync_at" TIMESTAMP(3),
ADD COLUMN     "last_scheduled_sync_at" TIMESTAMP(3),
ADD COLUMN     "deploy_portfolio_after_sync" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deploy_branch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN     "deploy_repo_url" TEXT,
ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "subscription_status" TEXT,
ADD COLUMN     "current_period_end" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "developers_user_id_key" ON "developers"("user_id");

-- AddForeignKey
ALTER TABLE "developers" ADD CONSTRAINT "developers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "developer_social_integrations" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developer_social_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "developer_social_integrations_developer_id_platform_key" ON "developer_social_integrations"("developer_id", "platform");

-- CreateIndex
CREATE INDEX "developer_social_integrations_developer_id_idx" ON "developer_social_integrations"("developer_id");

-- AddForeignKey
ALTER TABLE "developer_social_integrations" ADD CONSTRAINT "developer_social_integrations_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
