# Gym SaaS: design for approval

Status: **Approved 2026-10-02.** Phase 1 is implemented. See §11 for the decisions refined while building it.

Environment checked on 2026-10-02: PostgreSQL 18.6 is running on localhost. Database `gym_saas` exists, and schema `gym-admin-portal` exists and is empty.

---

## 1. Key decisions

| Area | Decision | Why |
|---|---|---|
| Framework | Next.js 16 App Router with React Server Components and Server Actions. **Refine is removed.** | All data must come from Postgres through a tenant-scoped server layer. Refine's client-side data provider would add a second, unscoped data path. |
| ORM | Prisma 7.10 (stable) with `@prisma/adapter-pg`, `prisma migrate` (never `db push`), and `prisma.config.ts` | Prisma 7 requires a driver adapter. The `prisma` CLI `latest` tag currently points at an 8.0 RC, so I'll pin 7.10.x for both the CLI and the client. |
| Auth | Auth.js v5 (`next-auth@5.0.0-beta.32`) with the Credentials provider and JWT session cookie. Passwords hashed with argon2id (`@node-rs/argon2`). | v5 is still tagged beta, but it is the only Auth.js line built for the App Router. The JWT strategy is required for Credentials, so revocation is handled with `sessionVersion` (§5). |
| Validation | Zod 4 schemas in `src/lib/validation/*`, shared by React Hook Form on the client and by Server Actions and API routes on the server | One definition per input |
| DB roles | `MIGRATION_DATABASE_URL` uses `postgres` (owner/superuser, for migrations and seed only). `DATABASE_URL` uses the new role **`gym_app`**: `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`. | Matches your brief. The setup script is `prisma/sql/001_app_role.sql`. |
| Schema | Everything lives in schema `"gym-admin-portal"` | The hyphen means every raw SQL statement (RLS, functions, grants) must quote it. Prisma handles that itself. |
| Rate limiting | A Postgres-backed fixed-window table (`RateLimitBucket`) | No Redis is needed, and limits still work when several app instances run |
| Files | A `StorageProvider` interface, with a local-disk implementation at `storage/<gymId>/<kind>/<uuid>` (outside `public/`). Files are served by an authenticated route handler. | S3 can be added later without changing callers |
| Billing | A `BillingProvider` interface with a `ManualBillingProvider` (super admin actions) now; Stripe later | As requested |
| Notifications | In-app `Notification` rows plus a `NotificationChannel` interface (`InAppChannel` now; email/SMS later) | As requested |
| Email (invites, password reset) | An `EmailProvider` interface. In dev, `DevOutboxEmailProvider` writes `.eml` files to `.dev-outbox/` (gitignored), never to logs. Invite links are also shown once to the inviter. | Tokens are never logged |
| Tests | Vitest for unit tests, plus Vitest integration tests against a **separate database `gym_saas_test`**. Playwright e2e tests run against the app pointed at `gym_saas_test`. | Running tests never wipes your dev data in `gym_saas` |

---

## 2. Prisma schema (draft)

Conventions:
- IDs are `cuid2` strings generated in the app. Because the ID exists before insert, it can be bound into the encryption AAD.
- Every table has `createdAt` and `updatedAt`.
- `Member`, `MembershipPlan`, `Payment` and `Invoice` also have `deletedAt` (soft delete).
- Money is stored as `Int` in minor units (paise/cents), with `currency` stored on the gym and snapshotted on invoices.
- `*Enc` columns hold ciphertext strings (§4), and `*BlindIndex` columns hold HMACs.
- Partial unique indexes (for example `email` unique per gym among rows that aren't deleted) are added in raw SQL in the migration, because Prisma can't express `WHERE "deletedAt" IS NULL`.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ───────────────────────────── Enums ─────────────────────────────
enum GymRole            { OWNER MANAGER FRONT_DESK TRAINER }
enum GymStatus          { TRIAL ACTIVE SUSPENDED CANCELLED }
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE EXPIRED CANCELLED }
enum SubscriptionAction { TRIAL_STARTED ACTIVATED EXTENDED PLAN_CHANGED SUSPENDED REACTIVATED CANCELLED EXPIRED }
enum BillingProviderKind { MANUAL STRIPE }
enum StaffStatus        { ACTIVE REMOVED }
enum PlanType           { MONTHLY QUARTERLY YEARLY CLASS_PACK }
enum MembershipStatus   { ACTIVE FROZEN CANCELLED EXPIRED }
enum InvoiceStatus      { OPEN PAID VOID }          // "overdue" = OPEN and dueDate < today (derived)
enum PaymentMethod      { CASH CARD TRANSFER }
enum PaymentStatus      { COMPLETED PARTIALLY_REFUNDED REFUNDED VOID }
enum CheckInMethod      { NAME_SEARCH MEMBER_ID QR }
enum CheckInResult      { ALLOWED DENIED_EXPIRED DENIED_FROZEN DENIED_NO_MEMBERSHIP }
enum ClassSessionStatus { SCHEDULED CANCELLED COMPLETED }
enum BookingStatus      { BOOKED WAITLISTED CANCELLED ATTENDED NO_SHOW }
enum NotificationType   { MEMBERSHIP_EXPIRING PAYMENT_OVERDUE PLAN_LIMIT_NEAR SUBSCRIPTION_EXPIRING SYSTEM }
enum FileKind           { GYM_LOGO MEMBER_PHOTO }
enum AuditActorType     { USER SUPPORT SYSTEM }

// ──────────────────────── Platform tables ────────────────────────
model User {
  id              String    @id
  email           String    @unique            // stored lower-cased (citext column via migration SQL)
  name            String
  passwordHash    String                       // argon2id
  isSuperAdmin    Boolean   @default(false)
  sessionVersion  Int       @default(1)        // bumped on password change / forced logout
  lastLoginAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  staff           StaffMember[]
  resetTokens     PasswordResetToken[]
}

model PasswordResetToken {
  id         String    @id
  userId     String
  tokenHash  String    @unique                 // SHA-256 of the random token; raw token never stored
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model PlatformPlan {
  id                   String   @id
  code                 String   @unique        // STARTER | GROWTH | PRO
  name                 String
  priceMonthlyMinor    Int
  currency             String   @default("INR")
  maxMembers           Int
  maxStaff             Int
  maxLocations         Int
  featureReports       Boolean
  featureCsvExport     Boolean
  featureClassBookings Boolean
  isActive             Boolean  @default(true)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  subscriptions        GymSubscription[]
}

model Gym {
  id           String    @id
  slug         String    @unique               // /g/[gymSlug]
  name         String
  status       GymStatus @default(TRIAL)
  timezone     String    @default("Asia/Kolkata")
  currency     String    @default("INR")
  taxRateBps   Int       @default(1800)        // 18.00% stored as basis points
  brandColor   String    @default("#ea580c")
  logoFileId   String?
  email        String?
  phone        String?                         // business phone: not personal data
  address      String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  subscription GymSubscription?
  // relations to every tenant table omitted here for brevity
}

model GymSubscription {
  id                     String              @id
  gymId                  String              @unique
  planId                 String
  status                 SubscriptionStatus
  trialEndsAt            DateTime?
  currentPeriodStart     DateTime
  currentPeriodEnd       DateTime
  provider               BillingProviderKind @default(MANUAL)
  providerCustomerId     String?
  providerSubscriptionId String?
  createdAt              DateTime            @default(now())
  updatedAt              DateTime            @updatedAt
  gym                    Gym                 @relation(fields: [gymId], references: [id])
  plan                   PlatformPlan        @relation(fields: [planId], references: [id])
}

model SubscriptionHistory {          // append-only (no UPDATE/DELETE grant)
  id                String             @id
  gymId             String
  action            SubscriptionAction
  fromPlanId        String?
  toPlanId          String?
  fromStatus        SubscriptionStatus?
  toStatus          SubscriptionStatus
  previousPeriodEnd DateTime?
  newPeriodEnd      DateTime?
  actorUserId       String?
  note              String?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  @@index([gymId, createdAt])
}

model SupportAccessSession {         // super admin "break-glass" access to one gym
  id           String    @id
  gymId        String
  superAdminId String
  reason       String
  startedAt    DateTime  @default(now())
  expiresAt    DateTime                       // max 60 minutes
  endedAt      DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@index([gymId])
  @@index([superAdminId, expiresAt])
}

model PlatformAuditLog {             // logins, failed logins, sign-ups, super admin actions; append-only
  id          String   @id
  actorUserId String?
  gymId       String?
  action      String                           // e.g. auth.login, auth.login_failed, admin.gym.suspend
  targetType  String?
  targetId    String?
  metadata    Json     @default("{}")         // redacted; never secrets or decrypted PII
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([createdAt])
  @@index([actorUserId])
}

model RateLimitBucket {
  key         String   @id                     // e.g. "login:ip:1.2.3.4", "login:email:<sha256>"
  count       Int
  windowStart DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// ───────────────── Tenant tables (all have gymId + RLS) ─────────────────
model StaffMember {                  // a user's role inside one gym (a user can have many)
  id            String      @id
  gymId         String
  userId        String
  role          GymRole
  status        StaffStatus @default(ACTIVE)
  title         String?
  bio           String?
  specialties   String[]
  phoneEnc      String?
  notesEnc      String?                        // staff notes (encrypted)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  user          User        @relation(fields: [userId], references: [id])
  @@unique([gymId, userId])
  @@index([gymId, role])
}

model StaffInvitation {
  id          String    @id
  gymId       String
  email       String
  role        GymRole
  tokenHash   String    @unique
  expiresAt   DateTime                          // 7 days
  acceptedAt  DateTime?
  revokedAt   DateTime?
  invitedById String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@index([gymId])
}

model StaffShift {                   // staff schedules
  id        String   @id
  gymId     String
  staffId   String
  locationId String
  startsAt  DateTime
  endsAt    DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([gymId, startsAt])
  @@index([staffId, startsAt])
}

model TrainerClient {                // trainer ↔ assigned members
  id        String   @id
  gymId     String
  trainerId String                             // StaffMember with role TRAINER
  memberId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([trainerId, memberId])
  @@index([gymId])
}

model Location {                     // counts against plan.maxLocations
  id        String   @id
  gymId     String
  name      String
  address   String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([gymId, name])
  @@index([gymId])
}

model OpeningHours {
  id          String   @id
  gymId       String
  locationId  String
  dayOfWeek   Int                               // 0 = Sunday
  openMinute  Int                               // minutes after midnight, gym time zone
  closeMinute Int
  isClosed    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([locationId, dayOfWeek])
  @@index([gymId])
}

model GymCounter {                   // per-gym sequences (member numbers, invoice numbers)
  id        String   @id
  gymId     String
  key       String                              // "member" | "invoice"
  value     Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([gymId, key])
}

model MembershipPlan {
  id                     String    @id
  gymId                  String
  name                   String                 // unique per gym where deletedAt IS NULL (SQL)
  type                   PlanType
  priceMinor             Int
  durationDays           Int                    // validity window (class packs too)
  classCredits           Int?                   // CLASS_PACK only
  allowFreeze            Boolean   @default(false)
  maxFreezeDays          Int       @default(0)
  cancellationNoticeDays Int       @default(0)
  cancellationFeeMinor   Int       @default(0)
  isActive               Boolean   @default(true)
  deletedAt              DateTime?
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt
  @@index([gymId])
}

model Member {
  id                    String    @id
  gymId                 String
  memberNumber          Int                     // per-gym, shown as "M-000123"
  firstName             String                  // plaintext: needed for name search
  lastName              String
  email                 String?                 // unique per gym where deletedAt IS NULL (SQL)
  phoneEnc              String?
  phoneBlindIndex       String?                 // HMAC for exact phone search
  addressEnc            String?
  dateOfBirthEnc        String?
  emergencyContactEnc   String?                 // JSON {name, phone, relation}, encrypted as one value
  healthNotesEnc        String?
  photoFileId           String?
  checkInCode           String                  // random, encoded in the member QR
  joinedAt              DateTime  @default(now())
  deletedAt             DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  @@unique([gymId, memberNumber])
  @@unique([gymId, checkInCode])
  @@index([gymId, lastName, firstName])
  @@index([gymId, phoneBlindIndex])
}

model MemberNote {                   // staff notes on a member (encrypted)
  id        String   @id
  gymId     String
  memberId  String
  authorId  String                              // StaffMember
  bodyEnc   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([gymId, memberId])
}

model Membership {
  id                    String           @id
  gymId                 String
  memberId              String
  planId                String
  status                MembershipStatus @default(ACTIVE)
  startDate             DateTime         @db.Date
  endDate               DateTime         @db.Date
  priceMinor            Int                      // snapshot of plan price at sale
  classCreditsRemaining Int?
  cancelledAt           DateTime?
  cancelReason          String?
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt
  @@index([gymId, memberId])
  @@index([gymId, status, endDate])              // "expiring in 7 days", "active members"
}

model MembershipFreeze {
  id           String   @id
  gymId        String
  membershipId String
  startDate    DateTime @db.Date
  endDate      DateTime @db.Date
  reason       String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([gymId, membershipId])
}

model Invoice {
  id               String        @id
  gymId            String
  number           Int                          // per-gym sequential, "INV-000042"
  memberId         String
  membershipId     String?
  status           InvoiceStatus @default(OPEN)
  currency         String
  subtotalMinor    Int
  taxMinor         Int
  totalMinor       Int
  amountPaidMinor  Int           @default(0)
  issuedAt         DateTime
  dueDate          DateTime      @db.Date
  paidAt           DateTime?
  deletedAt        DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  @@unique([gymId, number])
  @@index([gymId, status, dueDate])
  @@index([gymId, memberId])
}

model Payment {
  id           String        @id
  gymId        String
  memberId     String
  invoiceId    String?
  amountMinor  Int                              // > 0 (CHECK constraint)
  currency     String
  method       PaymentMethod
  status       PaymentStatus @default(COMPLETED)
  reference    String?
  receivedAt   DateTime
  recordedById String
  deletedAt    DateTime?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  @@index([gymId, receivedAt])
  @@index([gymId, memberId])
}

model Refund {
  id           String   @id
  gymId        String
  paymentId    String
  amountMinor  Int                              // CHECK: sum(refunds) <= payment.amount (enforced in tx)
  reason       String
  refundedAt   DateTime
  recordedById String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([gymId, paymentId])
}

model CheckIn {                      // every attempt is recorded, including denied ones
  id           String        @id
  gymId        String
  memberId     String
  locationId   String
  method       CheckInMethod
  result       CheckInResult
  checkedInAt  DateTime      @default(now())
  recordedById String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  @@index([gymId, checkedInAt])
  @@index([gymId, memberId, checkedInAt])
}

model Room {
  id         String   @id
  gymId      String
  locationId String
  name       String
  capacity   Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@unique([locationId, name])
  @@index([gymId])
}

model ClassType {
  id              String   @id
  gymId           String
  name            String
  description     String?
  color           String
  durationMinutes Int
  defaultCapacity Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([gymId, name])
}

model ClassSession {
  id          String             @id
  gymId       String
  classTypeId String
  trainerId   String                            // StaffMember
  roomId      String
  startsAt    DateTime
  endsAt      DateTime
  capacity    Int                               // CHECK capacity > 0 and <= room capacity (app)
  status      ClassSessionStatus @default(SCHEDULED)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt
  @@index([gymId, startsAt])
  @@index([trainerId, startsAt])
}

model Booking {
  id               String        @id
  gymId            String
  sessionId        String
  memberId         String
  status           BookingStatus
  waitlistPosition Int?
  bookedAt         DateTime      @default(now())
  cancelledAt      DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  @@unique([sessionId, memberId])
  @@index([gymId, sessionId, status])
}

model Notification {                 // fan-out: one row per recipient
  id              String           @id
  gymId           String
  recipientUserId String
  type            NotificationType
  title           String
  body            String
  entityType      String?
  entityId        String?
  dedupeKey       String                         // e.g. "expiring:<membershipId>:<userId>"
  readAt          DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  @@unique([gymId, dedupeKey])
  @@index([gymId, recipientUserId, readAt])
}

model FileAsset {
  id           String   @id
  gymId        String
  kind         FileKind
  storageKey   String                            // storage/<gymId>/<kind>/<uuid>.<ext>
  mimeType     String
  sizeBytes    Int
  sha256       String
  uploadedById String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([gymId])
}

model AuditLog {                     // tenant audit trail; append-only
  id          String         @id
  gymId       String
  actorUserId String?
  actorType   AuditActorType
  supportSessionId String?
  action      String                            // member.create, payment.refund, staff.role_change …
  entityType  String
  entityId    String?
  changes     Json           @default("{}")     // {field: {from, to}} with encrypted fields shown as "[redacted]"
  ip          String?
  userAgent   String?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  @@index([gymId, createdAt])
  @@index([gymId, entityType, entityId])
}
```

Relations and foreign keys are omitted above for readability. In the real file, every `xxxId` is a `@relation`, and every tenant table also has a composite foreign key `(gymId, parentId)` to the parent's `(gymId, id)`. That makes it **structurally impossible** for a row in gym A to reference a member, plan or session in gym B, even through a bug.

Extra constraints added in migration SQL:
- `CHECK` constraints:
  - Amounts: `amountMinor > 0`, `priceMinor >= 0`, `capacity > 0`
  - Dates: `endDate >= startDate` and `endsAt > startsAt`
- Partial unique indexes:
  - `Member(gymId, lower(email)) WHERE "deletedAt" IS NULL`
  - `MembershipPlan(gymId, name) WHERE "deletedAt" IS NULL`
- Booking constraint: `UNIQUE (sessionId, waitlistPosition) WHERE status='WAITLISTED'`
- `User.email` uses the `citext` type

---

## 3. Row-Level Security

### 3.1 Session settings (set with `set_config(..., true)` = `SET LOCAL`, per transaction)

| Setting | Set by | Meaning |
|---|---|---|
| `app.current_user_id` | every authenticated request | the logged-in user |
| `app.current_gym_id` | tenant requests (`/g/[slug]/…`) | the gym resolved from the slug **after** verifying membership |
| `app.support_session_id` | super admin support access only | the active `SupportAccessSession` |
| `app.platform_admin` | `/admin/*` requests, after checking `isSuperAdmin` in the DB | access to platform tables only |

### 3.2 Helper functions (owned by the owner role)

```sql
SET search_path = "gym-admin-portal";

CREATE FUNCTION app_current_gym_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.current_gym_id', true), '') $$;

CREATE FUNCTION app_current_user_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.current_user_id', true), '') $$;

CREATE FUNCTION app_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on'
          AND EXISTS (SELECT 1 FROM "User" u
                      WHERE u.id = app_current_user_id() AND u."isSuperAdmin") $$;

-- Defense in depth: the gym in the session must be one the user actually belongs to
-- (or has an active, unexpired support session for). SECURITY DEFINER so it can read
-- StaffMember/SupportAccessSession without recursive RLS.
CREATE FUNCTION app_can_access_current_gym() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = "gym-admin-portal" AS $$
  SELECT app_current_gym_id() IS NOT NULL AND app_current_user_id() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM "StaffMember" s
            WHERE s."gymId" = app_current_gym_id()
              AND s."userId" = app_current_user_id()
              AND s.status = 'ACTIVE')
    OR EXISTS (SELECT 1 FROM "SupportAccessSession" x
               WHERE x.id = NULLIF(current_setting('app.support_session_id', true), '')
                 AND x."gymId" = app_current_gym_id()
                 AND x."superAdminId" = app_current_user_id()
                 AND x."endedAt" IS NULL AND x."expiresAt" > now())
  )
$$;
```

### 3.3 Tenant table policy (generated for **every** tenant table)

The tenant tables are StaffMember, StaffInvitation, StaffShift, TrainerClient, Location, OpeningHours, GymCounter, MembershipPlan, Member, MemberNote, Membership, MembershipFreeze, Invoice, Payment, Refund, CheckIn, Room, ClassType, ClassSession, Booking, Notification, FileAsset, AuditLog and SubscriptionHistory.

```sql
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Member"
  USING      ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()))
  WITH CHECK ("gymId" = app_current_gym_id() AND (SELECT app_can_access_current_gym()));
```

- **Missing context returns zero rows.** If `app.current_gym_id` is unset, `app_current_gym_id()` returns `NULL`, `"gymId" = NULL` is never true, and writes fail the `WITH CHECK`.
- `(SELECT …)` makes Postgres evaluate the access check once per statement, not once per row.
- **Exceptions:**
  - `StaffMember` has an extra read policy, `"userId" = app_current_user_id()`, so the gym switcher can list a user's own gyms before a gym is chosen. It returns only the user's own rows.
  - `SubscriptionHistory` also allows read and insert when `app_is_platform_admin()`.

### 3.4 Platform tables

| Table | RLS policy for `gym_app` |
|---|---|
| `Gym` | read when `id = app_current_gym_id()` (and access check), or `id` is in the user's own StaffMember gyms, or platform admin. Write when platform admin, or the current gym is writable by its OWNER (settings). |
| `GymSubscription` | read for the current gym or platform admin. Write for platform admin only (and sign-up, see below). |
| `PlatformPlan` | read for everyone (pricing page). Write for platform admin. |
| `User` | read self, or users who share the current gym, or platform admin. Update self (name, password). |
| `SupportAccessSession`, `PlatformAuditLog` | platform admin only, except that inserts to `PlatformAuditLog` are always allowed (login and sign-up events) |
| `PasswordResetToken`, `RateLimitBucket` | **no direct access**. Only through `SECURITY DEFINER` functions (below). |

`SECURITY DEFINER` functions handle the few operations that must happen *before* a user or tenant is known. Each one is narrow and returns only what's needed:
- `auth_lookup_user(email)` returns `(id, passwordHash, sessionVersion, isSuperAdmin)` for login
- `signup_create_gym(...)` creates the gym, owner user, StaffMember, trial subscription and history in one transaction, and rejects a slug or email that's already taken
- `password_reset_issue/consume(...)`, `invitation_lookup/accept(...)`, `rate_limit_hit(key, limit, window)`
- `platform_stats()` gives super admin analytics as **aggregates only** (counts and revenue per gym, never member rows), and checks `app_is_platform_admin()` inside

### 3.5 Grants (`prisma/sql/001_app_role.sql` creates the role, and a migration applies grants)

```sql
CREATE ROLE gym_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE gym_saas TO gym_app;
GRANT USAGE ON SCHEMA "gym-admin-portal" TO gym_app;         -- no CREATE
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "gym-admin-portal" TO gym_app;
-- tighten:
REVOKE UPDATE, DELETE ON "AuditLog", "PlatformAuditLog", "SubscriptionHistory" FROM gym_app;  -- append-only
REVOKE DELETE ON "Member", "MembershipPlan", "Payment", "Invoice", "Gym", "User" FROM gym_app;  -- soft delete only
REVOKE ALL ON "PasswordResetToken", "RateLimitBucket", "_prisma_migrations" FROM gym_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "gym-admin-portal" TO gym_app;
```

There is also a trigger on the audit tables, `BEFORE UPDATE OR DELETE … RAISE EXCEPTION 'audit log is append-only'`, as a second barrier.

### 3.6 How the app uses it

```ts
// src/server/db/tenant.ts (sketch)
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) {
  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.userId}, true),
                                set_config('app.current_gym_id',  ${ctx.gymId},  true),
                                set_config('app.support_session_id', ${ctx.supportSessionId ?? ''}, true)`;
    return fn(tx);
  });
}
```

`TenantContext` is built **only** by `requireGymAccess(gymSlug)`. That function:
1. Reads the session.
2. Re-loads the user and checks `sessionVersion`.
3. Resolves the slug.
4. Confirms an ACTIVE `StaffMember` row, or a valid support session.
5. Returns `{userId, gymId, role, permissions, subscriptionState}`.

Services accept a `TenantContext`, never a raw `gymId` argument. Every page, layout, server action and route handler calls `requireGymAccess` first. Mutations also call `assertCan(ctx, "payments.record")` and `assertWritable(ctx)` (the read-only subscription state).

So there are three layers:
1. RLS in the DB
2. The tenant context, which comes only from the session
3. Explicit guards in every entry point

An ESLint rule (`no-restricted-imports`) prevents importing the raw Prisma client outside `src/server/db`.

---

## 4. Encryption

**Algorithm:** AES-256-GCM (Node `crypto`) with a random 96-bit IV per value and a 128-bit auth tag.

**Stored format:** a single `TEXT` value, with the key version embedded next to the ciphertext:
```
v1.<iv base64url>.<ciphertext base64url>.<tag base64url>
```

**AAD (associated data):** `gym:<gymId>|<Model>.<field>|<recordId>`. A ciphertext copied into another gym, column or row fails to decrypt, so it can't be silently swapped.

**Keys:**
- `ENCRYPTION_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"`
- `ENCRYPTION_ACTIVE_KEY_VERSION=2`
- Startup validation (Zod) checks that every key is exactly 32 bytes and that the active version exists.
- New writes always use the active key. Reads use the version in the prefix.

**Rotation:**
1. Add the new key and switch the active version.
2. Run `npm run crypto:rotate`. It walks each gym inside `withTenant` and re-encrypts any value whose prefix isn't the active version, in batches with progress output. Only redacted output is logged.
3. Remove the old key after the run reports 0 remaining.

**Encrypted fields:**
- Member: phone, address, date of birth, emergency contact (as JSON) and health notes
- Staff: phone and staff notes
- MemberNote: body

**Blind index:**
- `phoneBlindIndex = HMAC-SHA256(BLIND_INDEX_KEY, "<gymId>|phone|<E.164 normalised number>")`, stored as hex.
- It uses a separate key from encryption, and is scoped per gym, so the same phone number in two gyms gives different hashes.
- Search by phone is **exact match on the full number** (partial matching would leak information). Name and member-number search use plaintext columns.
- The blind index key is also versioned (`bidx1:` prefix), and `crypto:rotate` recomputes it.

**Boundary:** encryption and decryption happen only in `src/server/crypto/*` and the member/staff repositories. Decrypted values never reach the logger: the pino logger has a redaction list (`*.phone`, `*.healthNotes`, `password`, `token`, `*Enc`, `authorization`, `cookie`).

**Seed:** `prisma/seed.ts` imports the same `encryptField()` and `blindIndex()` functions as the app.

**Passwords and tokens:**
- Passwords: argon2id (`m=19456 KiB, t=2, p=1`, the OWASP baseline).
- Invite and reset tokens: 32 random bytes in base64url. Only `SHA-256(token)` is stored, with `expiresAt` and `usedAt`, and a token is consumed in the same transaction that uses it.

---

## 5. Auth and sessions

- **Session cookie:** Auth.js v5 Credentials provider with a JWT session in an `httpOnly`, `Secure` (production), `SameSite=Lax` cookie (`__Secure-` prefix in production). It lasts 8 hours and refreshes on activity.
- **JWT contents:** only `{ sub: userId, sv: sessionVersion }`. Roles and gyms are **not** trusted from the token. They're re-read from the DB on each request (one indexed query, cached per request with React `cache()`).
- **Revocation:**
  - A password change or reset increments `sessionVersion`, so all existing JWTs are rejected on their next request.
  - When a user is removed from a gym, the `StaffMember` status becomes REMOVED, so the next request to that gym fails immediately at both the app guard and RLS.
- **Failed logins** go to `PlatformAuditLog`, recording the IP and a hash of the email (no password).
- **Login rate limits:** 5 attempts per 15 minutes per email+IP, and 30 per 15 minutes per IP. Sign-up and password reset are limited to 5 per hour per IP.
- **Gym switching:** the header shows a gym switcher listing the user's ACTIVE StaffMember gyms. Switching navigates to `/g/<slug>/dashboard`. The active gym is in the URL, not the session, so a user can open two gyms in two tabs.

**Permissions** (checked server-side via `assertCan`):

| Permission | Owner | Manager | Front desk | Trainer |
|---|:-:|:-:|:-:|:-:|
| Dashboard (full) | ✓ | ✓ | limited (no revenue) | own schedule |
| Members: view | ✓ | ✓ | ✓ | assigned clients only |
| Members: create | ✓ | ✓ | ✓ | — |
| Members: edit / notes | ✓ | ✓ | contact details only | notes on own clients |
| Members: delete (soft) | ✓ | ✓ | — | — |
| Membership plans | ✓ | ✓ | view | — |
| Payments: record | ✓ | ✓ | ✓ | — |
| Payments: refund / void | ✓ | ✓ | — | — |
| Check-in | ✓ | ✓ | ✓ | — |
| Classes: manage | ✓ | ✓ | view / book | own classes only |
| Staff & invitations | ✓ | invite FRONT_DESK/TRAINER | — | — |
| Reports | ✓ | ✓ | — | — |
| Settings / billing | ✓ | — | — | — |
| Audit log | ✓ | — | — | — |

---

## 6. Subscriptions and read-only mode

- **Gym states:** `GymStatus` (TRIAL, ACTIVE, SUSPENDED, CANCELLED) combined with `GymSubscription.currentPeriodEnd`.
- **Writable when** status is TRIAL or ACTIVE **and** `now() < currentPeriodEnd` (for a trial, the period end is the trial end). Otherwise the gym is **read-only**.
  - In read-only mode, `assertWritable(ctx)` throws `GymReadOnlyError` in every mutation, and the layout shows a banner.
  - Data is never deleted.
  - The Owner can still reach the billing page.
- **Plan limits and feature flags** are enforced in services, for example `assertWithinLimit(ctx, "members")` before creating a member, and `assertFeature(ctx, "csvExport")` before an export. These throw `PlanLimitError`/`FeatureNotInPlanError`, which the UI shows as upgrade prompts.
- **Super admin actions** (activate, extend, change plan, suspend, reactivate, cancel) go through `BillingProvider.manual.*`. Each one writes `GymSubscription`, `SubscriptionHistory` and `PlatformAuditLog` in one transaction.
- **Expiry:** an idempotent `expireSubscriptions()` job runs on each request to the admin area and from `npm run jobs:run`, which can be scheduled with cron or Task Scheduler. Read-only mode is also computed from dates at request time, so it's correct even if the job never runs.

---

## 7. Concurrency and money rules

- **Booking:** inside one transaction, `SELECT … FROM "ClassSession" WHERE id=$1 FOR UPDATE` locks the session row. The transaction then counts BOOKED rows and inserts either BOOKED or WAITLISTED with the next position.
  - Cancelling a BOOKED booking promotes the first waitlisted booking in the same locked transaction.
  - An integration test fires 20 concurrent bookings at a 5-spot class and asserts exactly 5 BOOKED.
- **Recording a payment:** one transaction inserts the payment, updates `Invoice.amountPaidMinor`/`status`, activates or extends the `Membership`, and writes the audit log.
- **Refund:** locks the payment, checks that total refunds stay at or below the amount, and updates the payment status.
- **Tax:** `taxMinor = round_half_even(subtotal × taxRateBps / 10000)`, as a pure function with unit tests.
- **Dates:** "today", "this month" and "expiring in 7 days" are computed in the **gym's time zone** (`date-fns-tz`). Unit tests cover the boundaries.

---

## 8. Folder structure

```
.
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/                 # prisma migrate; includes RLS/grants/functions SQL
│  ├─ sql/001_app_role.sql        # creates gym_app role (run once as postgres)
│  ├─ seed.ts                     # entry for `prisma db seed`
│  └─ seed/                       # factories per domain (gyms, members, payments, …)
├─ prisma.config.ts
├─ scripts/                       # db-reset.ts, crypto-rotate.ts, jobs-run.ts, gen-keys.ts
├─ src/
│  ├─ proxy.ts                    # Next 16 request proxy: CSP nonce + security headers
│  ├─ app/
│  │  ├─ (public)/                # landing, pricing
│  │  ├─ (auth)/                  # login, signup, forgot/reset password, invite accept
│  │  ├─ select-gym/
│  │  ├─ g/[gymSlug]/             # tenant area (layout = requireGymAccess + shell)
│  │  ├─ admin/                   # super admin area
│  │  └─ api/                     # auth, files, exports, health
│  ├─ server/                     # server-only ("server-only" import guard)
│  │  ├─ env.ts                   # Zod env validation (fails fast)
│  │  ├─ db/                      # appDb, withTenant, withPlatform, errors
│  │  ├─ auth/                    # Auth.js config, password, session, guards
│  │  ├─ tenant/                  # requireGymAccess, permissions, plan limits, read-only
│  │  ├─ crypto/                  # keyring, encrypt/decrypt, blind index
│  │  ├─ services/                # members, memberships, plans, payments, checkins,
│  │  │                           # classes, staff, invitations, subscriptions, reports,
│  │  │                           # notifications, settings, audit, dashboard
│  │  ├─ billing/                 # BillingProvider + ManualBillingProvider
│  │  ├─ notifications/           # NotificationChannel + InAppChannel
│  │  ├─ email/                   # EmailProvider + DevOutbox
│  │  ├─ storage/                 # StorageProvider + LocalDisk, file sniffing
│  │  ├─ security/                # rate limit, request meta (IP/UA)
│  │  └─ logger.ts                # pino with redaction
│  ├─ domain/                     # pure business rules (no I/O): membership expiry,
│  │                              # freeze math, money/tax, booking capacity, plan limits
│  ├─ lib/validation/             # Zod schemas shared by forms and server
│  ├─ lib/                        # client-safe utils (cn, formatters)
│  └─ components/                 # ui/ (shadcn), layout/, data-table/, charts/, feature folders
├─ tests/
│  ├─ unit/                       # Vitest: domain rules, crypto
│  ├─ integration/                # Vitest + real Postgres (gym_saas_test): RLS, isolation,
│  │                              # concurrency, services, server actions, route handlers
│  └─ e2e/                        # Playwright
├─ docs/DESIGN.md
├─ .env.example
└─ README.md
```

Business logic lives in `src/domain` (pure) and `src/server/services` (I/O). Components only render, and they call Server Actions that are thin wrappers: **validate → guard → service → revalidate**.

---

## 9. Pages

**Public and auth**
| Route | Purpose |
|---|---|
| `/` | Landing page with a link to sign up or log in |
| `/pricing` | Platform plans (Starter, Growth, Pro) read from the DB |
| `/signup` | Sign-up wizard: gym details → owner account → choose plan → creates a 14-day trial |
| `/login` | Login form |
| `/forgot-password`, `/reset-password/[token]` | Password reset |
| `/invite/[token]` | Accept a staff invitation (create an account or link an existing one) |
| `/select-gym` | Gym picker shown after login when the user has 0 or more than 1 gym |

**Gym area: `/g/[gymSlug]/…`**
| Route | Roles |
|---|---|
| `dashboard` | all (content varies by role) |
| `members` (list: search, status filter, pagination) | Owner, Manager, Front desk; Trainer sees own clients |
| `members/new` | Owner, Manager, Front desk |
| `members/[memberId]` (tabs: profile, memberships, payments, attendance, notes) | as above |
| `plans` (membership plans: list and editor) | Owner, Manager (Front desk read) |
| `payments` (list, record payment, overdue tab) and `payments/[paymentId]` (refund) | Owner, Manager, Front desk |
| `invoices/[invoiceId]` (printable invoice) | Owner, Manager, Front desk |
| `check-in` (search by name, member ID or QR scanner, today's log) | Owner, Manager, Front desk |
| `classes` (weekly calendar) and `classes/[sessionId]` (roster, bookings, waitlist) | all (Trainer: own classes) |
| `classes/types` (class types and rooms) | Owner, Manager |
| `staff`, `staff/[staffId]` (profile, role, schedule, assigned clients) and `staff/invite` | Owner, Manager |
| `schedule` (my schedule) | Trainer and all staff |
| `reports` (revenue, attendance heatmap by day and hour, retention/churn, class popularity, CSV export) | Owner, Manager (feature-flagged) |
| `notifications` | all |
| `settings/general`, `settings/hours`, `settings/branding`, `settings/billing` | Owner |
| `audit-log` | Owner |

**Super admin: `/admin/…`**
| Route | Purpose |
|---|---|
| `admin` | Platform analytics (aggregates only): gyms by status, MRR, sign-ups, trial conversions |
| `admin/gyms` and `admin/gyms/[gymId]` | Gym list. Gym page shows the subscription, history, status actions (activate, extend, change plan, suspend, cancel) and a **Start support access** button. |
| `admin/plans` | Edit platform plans, limits and feature flags |
| `admin/support` | Active and past support sessions |
| `admin/audit` | Platform audit log |

**Support access:**
1. The super admin enters a reason and starts a session (60 minutes maximum).
2. They're redirected to `/g/<slug>/dashboard?support=<id>` with a red "Support access: all actions are logged" banner and an **End session** button.
3. Every request in support mode is audit-logged with `actorType = SUPPORT`.
4. Support access is **read-only by default**.

---

## 10. Phase 1 deliverables (after approval)

1. Replace the Refine demo, and add Prisma 7.10, Auth.js v5, Zod, argon2, Vitest and Playwright.
2. Add `src/server/env.ts`, `.env.example`, `.env` (gitignored) and `npm run keys:generate` for the encryption and blind-index keys.
3. Add `prisma/sql/001_app_role.sql`, then run it as `postgres` to create `gym_app` (and `gym_saas_test`).
4. Write the Prisma schema and the initial migration, plus a migration with the RLS, functions, grants and triggers.
5. Write the crypto utilities and their unit tests.
6. Write the seed (faker seed fixed at `20261002`) and `npm run db:reset`.
7. Add Auth.js login and logout, the session guard, rate limiting and audit of login events.
8. **Phase gate:** migrate, seed, `tsc`, ESLint, Vitest and `next build` all pass. Then I report what to test.

---

## 11. Changes made during Phase 1

| Topic | Original plan | What was built, and why |
|---|---|---|
| Timestamps | Prisma default `timestamp` | **`timestamptz(3)` everywhere**, the database default time zone set to **UTC**, and every pg connection opened with `TimeZone=UTC`. The pg adapter sends timestamps without an offset, and the server runs in IST, so instants were being shifted by 5½ h. That also made SQL `now()` comparisons (support-session expiry, rate limits) wrong. |
| "Unique among non-deleted rows" | Partial unique indexes | Prisma 7 can't express partial indexes, so later `migrate dev` runs would drop them. Instead, trigger-maintained key columns (`Member.emailKey`, `MembershipPlan.nameKey`) are `lower(value)` while live and `NULL` when soft-deleted, with plain `@@unique([gymId, key])`. |
| Support access | Read-only enforced in the app | **Also enforced in RLS.** Tenant read policies accept an active support session. Tenant write policies require active staff of the gym, so a support session can't write even if app code tried. |
| Audit inserts | `create` | `createMany` (INSERT without RETURNING). RETURNING is subject to SELECT policies, and the app role may append platform audit rows but not read them. |
| Waitlist position uniqueness | Partial unique index | Positions are assigned under the session's `FOR UPDATE` lock (Phase 6), with a CHECK that a position exists if and only if the booking is WAITLISTED. |
| `db:reset` | `prisma migrate reset` | Still used by `npm run db:reset` for you. Test suites rebuild only databases ending in `_test`, by drop schema → `migrate deploy` → grants. |

## 12. Notes from Phases 2–4

- **Queries inside one transaction run sequentially.** A transaction holds one pg connection, so app code never uses `Promise.all` inside `withTenant` / `withPlatformAdmin`.
- **Prisma itself can issue parallel relation queries** on a transaction connection. `pg` 8 serialises them, with a deprecation warning, and `pg` 9 will reject them, so `pg` stays on `^8` until Prisma changes this.
- **Forms send raw values to server actions.** The action validates again with the same Zod schema. Schemas with transforms (e.g. `""` → `null`, rupees → paise) aren't idempotent, so sending the client's transformed output would fail.
- **Display decryption is fault-tolerant.** `tryDecrypt` logs a failure (never the value) and shows a placeholder, so one corrupted or unknown-key value can't take a whole page down. Writes always use strict encryption.
- **Cancellation fees** are invoiced inside the cancellation transaction (Phase 5).
- **Functions returning `void`** (e.g. `pg_advisory_xact_lock`, `rate_limit_reset`) must be called with `$executeRaw`. `$queryRaw` can't deserialise `void`.
- **`npm audit` findings:** it reports 4 "high" issues, all inside the `prisma` CLI's own dependencies — `mysql2` (a MySQL driver this project never loads) and `deepmerge-ts` (used to merge our own trusted `prisma.config.ts`). No user input reaches them. The suggested `--force` fix downgrades to Prisma 6 and breaks the app, so it isn't applied. Re-check on each Prisma release.

