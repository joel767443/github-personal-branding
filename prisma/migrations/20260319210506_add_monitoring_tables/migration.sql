-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "user_login" TEXT,
    "developer_id" INTEGER,
    "summary" TEXT,
    "metadata" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "label" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_failures" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "stack" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_job_type_started_at_idx" ON "job_runs"("job_type", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_status_started_at_idx" ON "job_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_developer_id_started_at_idx" ON "job_runs"("developer_id", "started_at");

-- CreateIndex
CREATE INDEX "job_events_run_id_created_at_idx" ON "job_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "job_events_level_created_at_idx" ON "job_events"("level", "created_at");

-- CreateIndex
CREATE INDEX "job_failures_run_id_occurred_at_idx" ON "job_failures"("run_id", "occurred_at");

-- CreateIndex
CREATE INDEX "job_failures_occurred_at_idx" ON "job_failures"("occurred_at");

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_failures" ADD CONSTRAINT "job_failures_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
