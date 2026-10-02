-- CreateEnum
CREATE TYPE "EmailOtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'ROTATED', 'REUSE', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'AI_PROPOSAL');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE');

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" "SessionRevokeReason",
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(256),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_otps" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" VARCHAR(320) NOT NULL,
    "purpose" "EmailOtpPurpose" NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "actor_type" "AuditActorType" NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(64),
    "target_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" VARCHAR(128),
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_plans" (
    "user_id" UUID NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "valid_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_plans_pkey" PRIMARY KEY ("user_id")
);

-- Lookup a session by the SHA-256 of the presented refresh token (login refresh and reuse detection).
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- One successor per rotated session.
CREATE UNIQUE INDEX "auth_sessions_replaced_by_id_key" ON "auth_sessions"("replaced_by_id");

-- List a user's sessions.
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- Revoke every session in a refresh-token family.
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");

-- Resend cooldown and the per-email hourly OTP cap.
CREATE INDEX "email_otps_email_purpose_created_at_idx" ON "email_otps"("email", "purpose", "created_at");

-- Delete OTP rows only after expiry plus 24 hours.
CREATE INDEX "email_otps_expires_at_idx" ON "email_otps"("expires_at");

-- One Google account links to at most one PlanIT user.
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- Read a user's audit history in time order.
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK constraints and the append-only audit trigger. Prisma does not model these.
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_refresh_token_hash_hex_check" CHECK ("refresh_token_hash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "auth_sessions_revoke_consistency_check" CHECK (
    ("revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
  );

ALTER TABLE "email_otps"
  ADD CONSTRAINT "email_otps_email_normalized_check" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "email_otps_code_hash_hex_check" CHECK ("code_hash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "email_otps_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5);

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_format_check" CHECK ("action" ~ '^[a-z0-9_.]+$'),
  ADD CONSTRAINT "audit_logs_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object'),
  ADD CONSTRAINT "audit_logs_ip_hash_hex_check" CHECK ("ip_hash" IS NULL OR "ip_hash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "audit_logs_request_id_format_check" CHECK (
    "request_id" IS NULL OR "request_id" ~ '^[A-Za-z0-9._-]{8,128}$'
  );

CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "audit_logs_append_only"();
