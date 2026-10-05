-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(10000),
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "due_date" DATE,
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "estimated_minutes" INTEGER,
    "completed_at" TIMESTAMPTZ(3),
    "sort_order" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- Filter and list one user's tasks by status: WHERE user_id = ? AND status IN (...)
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- Filter by a calendar day and sort by due date: WHERE user_id = ? AND due_date = ? / ORDER BY due_date
CREATE INDEX "tasks_user_id_due_date_idx" ON "tasks"("user_id", "due_date");

-- Filter and sort by scheduled start: WHERE user_id = ? AND scheduled_start >= ? AND scheduled_start <= ?
CREATE INDEX "tasks_user_id_scheduled_start_idx" ON "tasks"("user_id", "scheduled_start");

-- Filter and sort by priority: WHERE user_id = ? AND priority IN (...) / ORDER BY priority
CREATE INDEX "tasks_user_id_priority_idx" ON "tasks"("user_id", "priority");

-- Manual order: WHERE user_id = ? ORDER BY sort_order, id
CREATE INDEX "tasks_user_id_sort_order_idx" ON "tasks"("user_id", "sort_order");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma does not model these). They backstop the
-- application rules in @planit/shared; see docs/database-schema.md and decision D-039.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_schedule_check" CHECK (
    ("scheduled_start" IS NULL AND "scheduled_end" IS NULL)
    OR ("scheduled_end" > "scheduled_start")
  ),
  ADD CONSTRAINT "tasks_estimated_minutes_check" CHECK (
    "estimated_minutes" IS NULL OR "estimated_minutes" BETWEEN 1 AND 10080
  ),
  ADD CONSTRAINT "tasks_completed_at_check" CHECK (
    ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "tasks_title_length_check" CHECK (
    char_length("title") BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT "tasks_notes_length_check" CHECK (
    "notes" IS NULL OR char_length("notes") BETWEEN 1 AND 10000
  ),
  ADD CONSTRAINT "tasks_sort_order_length_check" CHECK (
    char_length("sort_order") BETWEEN 1 AND 64
  );
