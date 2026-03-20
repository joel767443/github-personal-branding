-- DropForeignKey
ALTER TABLE "Commit" DROP CONSTRAINT "Commit_repoId_fkey";

-- DropForeignKey
ALTER TABLE "Languages" DROP CONSTRAINT "Languages_repoId_fkey";

-- DropForeignKey
ALTER TABLE "Repo" DROP CONSTRAINT "Repo_developerId_fkey";

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Languages" ADD CONSTRAINT "Languages_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
