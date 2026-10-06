-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('PENDING', 'MATERIALIZED', 'SKIPPED', 'COMPLETED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "recurring_task_id" UUID;

-- CreateTable
CREATE TABLE "recurring_tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(10000),
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "recurrence_rule" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "timezone" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "estimated_minutes" INTEGER,
    "default_start_minute" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_occurrences" (
    "id" UUID NOT NULL,
    "recurring_task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID,
    "occurrence_date" DATE NOT NULL,
    "status" "OccurrenceStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_occurrences_pkey" PRIMARY KEY ("id")
);

-- List one user's enabled series for the daily generator: WHERE user_id = ? AND enabled = ?
CREATE INDEX "recurring_tasks_user_id_enabled_idx" ON "recurring_tasks"("user_id", "enabled");

-- List one user's series by start date: WHERE user_id = ? ORDER BY start_date
CREATE INDEX "recurring_tasks_user_id_start_date_idx" ON "recurring_tasks"("user_id", "start_date");

-- One generated task belongs to at most one occurrence row.
CREATE UNIQUE INDEX "task_occurrences_task_id_key" ON "task_occurrences"("task_id");

-- Two workers cannot insert the same series date. The loser keeps the row that committed first.
CREATE UNIQUE INDEX "task_occurrences_recurring_task_id_occurrence_date_key" ON "task_occurrences"("recurring_task_id", "occurrence_date");

-- Delete or detach every task generated for one series: WHERE user_id = ? AND recurring_task_id = ?
CREATE INDEX "tasks_user_id_recurring_task_id_idx" ON "tasks"("user_id", "recurring_task_id");

-- AddForeignKey
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_recurring_task_id_fkey" FOREIGN KEY ("recurring_task_id") REFERENCES "recurring_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_task_id_fkey" FOREIGN KEY ("recurring_task_id") REFERENCES "recurring_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma does not model these). They backstop the
-- application rules in @planit/shared; see docs/database-schema.md and decision D-041.
ALTER TABLE "recurring_tasks"
  ADD CONSTRAINT "recurring_tasks_title_length_check" CHECK (
    char_length("title") BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT "recurring_tasks_notes_length_check" CHECK (
    "notes" IS NULL OR char_length("notes") BETWEEN 1 AND 10000
  ),
  ADD CONSTRAINT "recurring_tasks_recurrence_rule_length_check" CHECK (
    char_length("recurrence_rule") BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT "recurring_tasks_end_date_check" CHECK (
    "end_date" IS NULL OR "end_date" >= "start_date"
  ),
  ADD CONSTRAINT "recurring_tasks_estimated_minutes_check" CHECK (
    "estimated_minutes" IS NULL OR "estimated_minutes" BETWEEN 1 AND 10080
  ),
  ADD CONSTRAINT "recurring_tasks_default_start_minute_check" CHECK (
    "default_start_minute" IS NULL OR "default_start_minute" BETWEEN 0 AND 1439
  ),
  ADD CONSTRAINT "recurring_tasks_default_start_minute_requires_estimate_check" CHECK (
    "default_start_minute" IS NULL OR "estimated_minutes" IS NOT NULL
  );
