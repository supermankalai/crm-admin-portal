-- Least-privilege grants for the app role. Run after every migration (npm run db:grants).
-- Migrations recreate tables, so grants are (re)applied here rather than inside migrations.

GRANT USAGE ON SCHEMA "gym-admin-portal" TO gym_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "gym-admin-portal" TO gym_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "gym-admin-portal" TO gym_app;

-- Migration bookkeeping is owner-only.
REVOKE ALL ON "gym-admin-portal"."_prisma_migrations" FROM gym_app;

-- Append-only: audit trails and subscription history can never be edited or deleted by the app.
REVOKE UPDATE, DELETE ON
  "gym-admin-portal"."AuditLog",
  "gym-admin-portal"."PlatformAuditLog",
  "gym-admin-portal"."SubscriptionHistory"
FROM gym_app;

-- Records of money and attendance are immutable: corrections are new entries.
REVOKE UPDATE, DELETE ON
  "gym-admin-portal"."Refund",
  "gym-admin-portal"."CheckIn"
FROM gym_app;

-- Soft delete only (deletedAt) — or never deleted from the app at all.
REVOKE DELETE ON
  "gym-admin-portal"."Member",
  "gym-admin-portal"."MembershipPlan",
  "gym-admin-portal"."Payment",
  "gym-admin-portal"."Invoice",
  "gym-admin-portal"."Refund",
  "gym-admin-portal"."Gym",
  "gym-admin-portal"."GymSubscription",
  "gym-admin-portal"."PlatformPlan",
  "gym-admin-portal"."User"
FROM gym_app;

-- Reachable only through SECURITY DEFINER functions.
REVOKE ALL ON
  "gym-admin-portal"."PasswordResetToken",
  "gym-admin-portal"."RateLimitBucket",
  "gym-admin-portal"."MobileRefreshToken",
  "gym-admin-portal"."LoginOtp"
FROM gym_app;

-- Mobile device sessions are created only by mobile_session_start(); users may read and revoke
-- their own (RLS), never insert or delete them directly.
REVOKE INSERT, DELETE ON "gym-admin-portal"."MobileDeviceSession" FROM gym_app;

-- Member app accounts are disabled, never deleted (the audit trail refers to them).
REVOKE DELETE ON "gym-admin-portal"."MemberAccount" FROM gym_app;

-- Personal training sessions are cancelled (status), never deleted.
REVOKE DELETE ON "gym-admin-portal"."TrainingSession" FROM gym_app;

-- Ended PT assignments are history: written once, never edited or deleted by the app.
REVOKE UPDATE, DELETE ON "gym-admin-portal"."PtAssignmentHistory" FROM gym_app;

-- PT packages are archived, and sold packages cancelled, never deleted (invoices point at them).
REVOKE DELETE ON "gym-admin-portal"."PtPackage", "gym-admin-portal"."PtPackagePurchase" FROM gym_app;

-- Push deliveries are written and read only by the push job (owner role).
REVOKE ALL ON "gym-admin-portal"."PushDelivery" FROM gym_app;

-- Announcements are never edited after publishing; deletion requests are never deleted.
REVOKE UPDATE ON "gym-admin-portal"."Announcement" FROM gym_app;
REVOKE DELETE ON "gym-admin-portal"."AccountDeletionRequest" FROM gym_app;
