/*
  Warnings:

  - You are about to drop the `tech_stacks` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Languages" ADD COLUMN     "bytes" BIGINT;

-- AlterTable
ALTER TABLE "developers" ADD COLUMN     "linkedin_summary" TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "tech_stacks";

-- CreateTable
CREATE TABLE "certifications" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "name" TEXT,
    "issuer" TEXT,
    "issued" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_experiences" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "title" TEXT,
    "company" TEXT,
    "dates" TEXT,
    "location" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "degree" TEXT,
    "institution" TEXT,
    "dates" TEXT,
    "location" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "language_catalog" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "language_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "url" TEXT,
    "dates" TEXT,
    "source" TEXT NOT NULL DEFAULT 'linkedin',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_languages" (
    "project_id" INTEGER NOT NULL,
    "language_id" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "project_languages_pkey" PRIMARY KEY ("project_id","language_id")
);

-- CreateTable
CREATE TABLE "developer_linkedin_top_skills" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_linkedin_top_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_linkedin_skills" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_linkedin_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_recommendations" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "recommender_first_name" TEXT,
    "recommender_last_name" TEXT,
    "job_title" TEXT,
    "company" TEXT,
    "relationship" TEXT,
    "text" TEXT,
    "date" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_publications" (
    "id" SERIAL NOT NULL,
    "developer_id" INTEGER NOT NULL,
    "title" TEXT,
    "publisher" TEXT,
    "date" TEXT,
    "url" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certifications_developer_id_idx" ON "certifications"("developer_id");

-- CreateIndex
CREATE INDEX "developer_experiences_developer_id_idx" ON "developer_experiences"("developer_id");

-- CreateIndex
CREATE INDEX "education_developer_id_idx" ON "education"("developer_id");

-- CreateIndex
CREATE UNIQUE INDEX "language_catalog_name_key" ON "language_catalog"("name");

-- CreateIndex
CREATE INDEX "projects_developer_id_idx" ON "projects"("developer_id");

-- CreateIndex
CREATE INDEX "developer_linkedin_top_skills_developer_id_idx" ON "developer_linkedin_top_skills"("developer_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_linkedin_top_skills_developer_id_name_key" ON "developer_linkedin_top_skills"("developer_id", "name");

-- CreateIndex
CREATE INDEX "developer_linkedin_skills_developer_id_idx" ON "developer_linkedin_skills"("developer_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_linkedin_skills_developer_id_name_key" ON "developer_linkedin_skills"("developer_id", "name");

-- CreateIndex
CREATE INDEX "developer_recommendations_developer_id_idx" ON "developer_recommendations"("developer_id");

-- CreateIndex
CREATE INDEX "developer_publications_developer_id_idx" ON "developer_publications"("developer_id");

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_experiences" ADD CONSTRAINT "developer_experiences_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education" ADD CONSTRAINT "education_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_languages" ADD CONSTRAINT "project_languages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_languages" ADD CONSTRAINT "project_languages_language_id_fkey" FOREIGN KEY ("language_id") REFERENCES "language_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_linkedin_top_skills" ADD CONSTRAINT "developer_linkedin_top_skills_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_linkedin_skills" ADD CONSTRAINT "developer_linkedin_skills_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_recommendations" ADD CONSTRAINT "developer_recommendations_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_publications" ADD CONSTRAINT "developer_publications_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "developer_architectures_unique" RENAME TO "developer_architectures_developerId_name_key";
