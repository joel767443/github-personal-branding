-- CreateTable
CREATE TABLE "repo_tech_stacks" (
    "id" SERIAL NOT NULL,
    "repo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "repo_tech_stacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repo_tech_stacks_repo_id_idx" ON "repo_tech_stacks"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_tech_stacks_repo_id_name_key" ON "repo_tech_stacks"("repo_id", "name");

-- AddForeignKey
ALTER TABLE "repo_tech_stacks" ADD CONSTRAINT "repo_tech_stacks_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
