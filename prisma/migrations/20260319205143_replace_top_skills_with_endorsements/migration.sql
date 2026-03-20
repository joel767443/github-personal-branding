/*
  Warnings:

  - You are about to drop the `developer_linkedin_top_skills` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "developer_linkedin_top_skills" DROP CONSTRAINT "developer_linkedin_top_skills_developer_id_fkey";

-- DropTable
DROP TABLE "developer_linkedin_top_skills";

-- CreateTable
CREATE TABLE "developer_linkedin_received_endorsements" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "skill_name" TEXT,
    "endorser_first_name" TEXT,
    "endorser_last_name" TEXT,
    "endorser_company" TEXT,
    "endorser_job_title" TEXT,
    "endorsed_on" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_linkedin_received_endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "developer_linkedin_received_endorsements_developer_id_idx" ON "developer_linkedin_received_endorsements"("developer_id");

-- AddForeignKey
ALTER TABLE "developer_linkedin_received_endorsements" ADD CONSTRAINT "developer_linkedin_received_endorsements_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
