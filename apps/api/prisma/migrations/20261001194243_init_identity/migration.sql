-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TaskSortOrder" AS ENUM ('MANUAL', 'PRIORITY', 'DUE_DATE', 'SCHEDULED_START', 'CREATED_AT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "username" VARCHAR(30),
    "display_name" VARCHAR(50),
    "avatar_id" VARCHAR(64),
    "bio" VARCHAR(280),
    "birthday" DATE,
    "country" CHAR(2),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "week_starts_on" SMALLINT NOT NULL DEFAULT 1,
    "default_task_sort" "TaskSortOrder" NOT NULL DEFAULT 'MANUAL',
    "preferred_focus_start" SMALLINT,
    "preferred_focus_end" SMALLINT,
    "daily_focus_goal_minutes" SMALLINT,
    "notification_preferences" JSONB NOT NULL DEFAULT '{}',
    "planning_preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma does not model these). They are a database-level
-- backstop for invariants the application already enforces; see docs/database-schema.md.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "users_username_format_check" CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9_]{3,30}$'),
  ADD CONSTRAINT "users_country_format_check" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_week_starts_on_check" CHECK ("week_starts_on" BETWEEN 0 AND 6),
  ADD CONSTRAINT "user_preferences_focus_window_check" CHECK (
    ("preferred_focus_start" IS NULL OR "preferred_focus_start" BETWEEN 0 AND 1439)
    AND ("preferred_focus_end" IS NULL OR "preferred_focus_end" BETWEEN 0 AND 1439)
  ),
  ADD CONSTRAINT "user_preferences_daily_focus_goal_check" CHECK (
    "daily_focus_goal_minutes" IS NULL OR "daily_focus_goal_minutes" BETWEEN 1 AND 1440
  ),
  ADD CONSTRAINT "user_preferences_documents_are_objects_check" CHECK (
    jsonb_typeof("notification_preferences") = 'object'
    AND jsonb_typeof("planning_preferences") = 'object'
  );
