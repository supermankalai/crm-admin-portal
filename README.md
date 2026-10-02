# FitCRM: multi-tenant gym management SaaS

One platform, many gyms. Each gym subscribes to a plan and manages only its own members, staff, payments and classes. Tenant isolation is enforced in PostgreSQL itself (Row-Level Security), in a tenant-scoped data layer, and in server-side checks on every entry point.

> **Build status: Phase 3 of 8 complete.** Done so far:
> - **Phase 1:** database roles, RLS, encryption, seed, login
> - **Phase 2:** multi-tenant layer, gym sign-up, gym switching, roles, layout
> - **Phase 3:** platform subscriptions, plan limits, super admin area and support access
>
> Members, payments, classes and the other gym features follow in Phases 4–7. See [docs/DESIGN.md](docs/DESIGN.md) for the approved architecture.

**Stack:** Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 + shadcn/ui · PostgreSQL 18 + Prisma 7 (migrations) · Auth.js v5 (credentials, argon2id) · Zod 4 · React Hook Form · Vitest · Playwright

---

## 1. Setup

Prerequisites: Node.js 22 or later, and a local PostgreSQL 16+ server. Docker is not used.

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then fill it in (see §3)
npm run keys:generate            # prints fresh secrets to paste into .env

npm run db:setup-roles           # once: creates the gym_app role (+ gym_saas_test database)
npm run db:migrate               # applies migrations (tables, RLS, functions) + grants
npm run db:seed                  # inserts the demo data (safe to re-run)

npm run dev                      # http://localhost:3000
```

`npm run db:reset` performs the full rebuild in one step: drop the schema, run all migrations (including RLS), apply grants, then seed.

On startup the app validates every environment variable. It also **refuses to start if `DATABASE_URL` connects as a superuser or a role with BYPASSRLS** ([src/instrumentation.ts](src/instrumentation.ts)).

## 2. Database roles

| Role | Used by | Privileges |
|---|---|---|
| `postgres` (owner) | `MIGRATION_DATABASE_URL`: Prisma migrations, the seed, `crypto:rotate` | Owns the schema. Never used by the running app. |
| `gym_app` | `DATABASE_URL`: the running application | `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`. Has `USAGE` on the schema but not `CREATE`. Can SELECT/INSERT/UPDATE/DELETE tables, with the exceptions below. |

What `gym_app` cannot do ([prisma/sql/002_grants.sql](prisma/sql/002_grants.sql)):
- `UPDATE` or `DELETE` on `AuditLog`, `PlatformAuditLog` or `SubscriptionHistory`, which are append-only. A trigger also blocks this for the owner role.
- `DELETE` on `Member`, `MembershipPlan`, `Payment`, `Invoice`, `Refund`, `Gym`, `User` or `GymSubscription`. These use soft delete only.
- Any access to `PasswordResetToken` or `RateLimitBucket`, or to `_prisma_migrations`. The first two are reachable only through narrow `SECURITY DEFINER` functions.
- Create objects, disable RLS, or change `isSuperAdmin` (trigger).

Role setup lives in [prisma/sql/001_app_role.sql](prisma/sql/001_app_role.sql), run via `npm run db:setup-roles`. It also sets the database time zone to **UTC**, a 15 s statement timeout and a 30 s idle-in-transaction timeout for `gym_app`.

## 3. Environment variables

All variables are validated with Zod at startup ([src/server/env.ts](src/server/env.ts)). Missing or invalid ones are listed by name; values are never printed.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | — | `development` / `test` / `production` |
| `APP_URL` | ✓ | Public base URL. `https://` turns on Secure cookies. |
| `DATABASE_URL` | ✓ | `gym_app` connection string. Must not be `postgres` and must differ from the migration role. |
| `MIGRATION_DATABASE_URL` | for CLI | Owner connection, for migrations and the seed only |
| `DATABASE_SCHEMA` | — | Defaults to `gym-admin-portal` |
| `APP_DB_PASSWORD` | for setup | Password `db:setup-roles` gives `gym_app`. Must match `DATABASE_URL`. |
| `TEST_MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL` | for tests | Must point at a database whose name ends in `_test` |
| `AUTH_SECRET` | ✓ | JWT signing secret, at least 32 characters |
| `AUTH_TRUST_HOST` | — | `true` behind a trusted reverse proxy or on localhost |
| `ENCRYPTION_KEYS` | ✓ | `version:base64key` pairs, comma-separated. Each key is 32 bytes. |
| `ENCRYPTION_ACTIVE_KEY_VERSION` | ✓ | Version used for new writes. Must exist in `ENCRYPTION_KEYS`. |
| `BLIND_INDEX_KEY`, `BLIND_INDEX_KEY_VERSION` | ✓ | HMAC key (32 bytes, base64) for searchable encrypted fields |
| `STORAGE_DIR` | — | Upload root. Files go to `STORAGE_DIR/<gymId>/…`. |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | ✓ | `dev-outbox` writes emails to `.dev-outbox/` |
| `LOG_LEVEL` | — | `trace`, `debug`, `info`, `warn` or `error` |

`.env` is gitignored. [.env.example](.env.example) lists every variable with placeholder values only.

## 4. Migrations and Row-Level Security

All schema changes go through `prisma migrate` (never `db push`):

| Migration | Contents |
|---|---|
| `…_init` | Tables, indexes, composite `(gymId, id)` foreign keys |
| `…_security_rls` | CHECK constraints, triggers, RLS helper functions, policies on every table, and the pre-auth `SECURITY DEFINER` functions |
| `…_timestamptz` | Every instant stored as `timestamptz` |

To create a new migration: `npx prisma migrate dev --name <change> --create-only`, review the SQL, then run `npm run db:migrate`. CHECK constraints, triggers, functions and policies are written by hand in migration SQL. Prisma does not manage them, so it never tries to drop them.

**How isolation works:**
1. **Session context.** Every request runs inside a transaction that first sets `app.current_user_id`, `app.current_gym_id` and friends with `set_config(…, true)`, the equivalent of `SET LOCAL` ([src/server/db/run-in-context.ts](src/server/db/run-in-context.ts)).
2. **Policies.** Every tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY`. Reads require `gymId = app_current_gym_id()` **and** that the current user is active staff of that gym, or has a live support session. Writes require active staff, so support access is read-only at the database level.
3. **Fails closed.** A missing setting resolves to `NULL`, which matches no rows. Inserts are rejected.
4. **Structural isolation.** Child rows reference parents by `(gymId, parentId)`, so a cross-gym reference is impossible even for the owner role.
5. **Lint guard.** Features can't import the raw Prisma client (`eslint no-restricted-imports`). They must use `withTenant`, `withUser` or `withPlatformAdmin`.

## 4a. Tenancy in the application

Every gym URL is `/g/<gymSlug>/…`. The slug only chooses which of *your* gyms you mean. It is never trusted on its own.

- **Pages and layouts** call `requireGymAccess(slug)` ([src/server/tenant](src/server/tenant)). It re-reads the session user from the database, then checks they are **active staff** of the gym with that slug, and builds a `TenantContext`: gym, role, permissions, plan, and subscription access. Anyone else gets a **404**, so other gyms' slugs can't be probed. A super admin without a staff role also gets a 404; support access arrives in Phase 3.
- **Server actions** are wrapped in `gymAction()` ([src/server/actions/gym-action.ts](src/server/actions/gym-action.ts)). It runs the same tenant check, then the permission check (`assertCan`) and the read-only check for writes (`assertWritable`), then Zod validation with the shared schema. Failures come back as friendly messages and are logged on the server.
- **API routes** do the same check. For example, `GET /api/g/<slug>/context` returns 401 without a session and 404 for other gyms.
- **Database access** goes through `inTenant(ctx, tx => …)`. It sets the RLS context from the verified `TenantContext`, never from request input.
- **Roles and permissions** are a single matrix in [src/domain/permissions.ts](src/domain/permissions.ts) (Owner, Manager, Front desk, Trainer). Navigation is filtered by it, and each page and action checks it again.
- **Read-only mode** applies when a trial or subscription ends or the gym is suspended. A banner is shown, every write is refused, and the data is kept. It's computed from dates on each request, so it works even if no background job runs.

**Sign-up** (`/signup`): gym details → owner account → plan, which starts a **14-day trial**. A signed-in user can add another gym and becomes its owner. Sign-up goes through the `signup_create_gym` database function: one transaction creates the gym, owner, trial, subscription history, default location and opening hours, counters and audit rows. Sign-up is rate-limited to 5 per hour per IP.

**Gym switching:** use the gym menu at the top of the sidebar, or `/select-gym`. A user with exactly one gym goes straight to its dashboard after login.

## 4b. Platform administration and subscriptions

**Super admin area (`/admin`).** Super admins land here after login. `isSuperAdmin` is re-read from the database on every request; anyone else gets a 404.

| Page | What it does |
|---|---|
| `/admin` | Platform analytics: gyms by status, MRR, trials ending soon, member and check-in totals, sign-ups per month, gyms per plan. Numbers come from the `platform_stats()` database function and are **aggregates only**. |
| `/admin/gyms`, `/admin/gyms/[id]` | Gym list with search and status filter, and per-gym usage counts. The gym page has the subscription actions, subscription history, platform audit and support access. |
| `/admin/plans` | Edit Starter / Growth / Pro: price, maximum members, staff and locations, and the reports, CSV export and class booking flags |
| `/admin/support` | All support sessions: who, which gym, why, and when |
| `/admin/audit` | Platform audit log (logins, failed logins, sign-ups, subscription, plan and support events). Append-only. |

**Subscriptions (manual billing).** A super admin can activate (1–24 months), extend (days), change plan, suspend, reactivate or cancel a gym's subscription.
- Destructive actions need a reason and a confirmation.
- Each change runs in one transaction: it locks the subscription row, updates the gym and subscription, appends `SubscriptionHistory`, and writes a platform audit entry.
- The rules are pure functions in [src/domain/subscription-changes.ts](src/domain/subscription-changes.ts). Persistence sits behind a `BillingProvider` interface ([src/server/billing](src/server/billing)), so a Stripe provider can plug in later and reuse the same history, audit and read-only behaviour.
- `npm run jobs:run` (schedule it every few minutes) marks ended periods `EXPIRED`, with history, and clears stale rate-limit buckets. Read-only mode doesn't depend on it.

**Plan limits and feature flags.**
- `assertWithinLimit()` and `assertFeature()` run on the server before members, staff or locations are created, and before reports or exports. The UI shows upgrade messages such as *"Your Starter plan includes up to 150 members, and you've reached it. Upgrade your plan to add more."*
- The database trigger `enforce_plan_limits` enforces the same limits again. It takes a per-gym advisory lock, so concurrent sign-ups can't overshoot. It applies to the owner role too, and to bulk inserts as a whole.
- Lowering a plan never deletes data. It only blocks *new* rows beyond the new limit.
- Owners see usage meters, included features and subscription history at **`/g/<slug>/billing`**.

**Support access.** A super admin cannot open a gym's pages by default (404). To help a gym:
1. Open the gym in `/admin`, enter a **reason** (at least 10 characters), and click *Start support access*. This creates a `SupportAccessSession` (60 minutes maximum, one at a time) and logs `support.start`.
2. They land in the gym with a red banner. **Everything is read-only**: `assertWritable` refuses writes, and RLS write policies require real staff membership.
3. **Every page they open is written to the gym's own audit log** as `support.view`, with `actorType = SUPPORT`.
4. *End support session* (or expiry) closes access immediately. The session is re-validated against the database on every request (owner, gym and expiry). The browser cookie holds only the session id and grants nothing by itself.

## 5. Encryption

Fields encrypted at the application level with **AES-256-GCM** ([src/server/crypto](src/server/crypto)):
- Member: phone, address, date of birth, emergency contact, health notes
- Staff: phone, staff notes
- Member notes: body

How values are stored and protected:
- **Format:** `v<keyVersion>.<iv>.<ciphertext>.<tag>`, so the key version sits next to every value.
- **AAD:** each value is bound to `gym|model.field|recordId`. A ciphertext copied to another gym, column or row fails to decrypt.
- **Phone search** uses a per-gym **HMAC-SHA256 blind index** (`phoneBlindIndex`, exact match only), with a separate key.
- **Passwords** use argon2id (m=19 MiB, t=2, p=1). Reset and invite tokens are stored only as SHA-256 hashes.
- **Logs** pass through a redacting logger. Passwords, tokens, keys and personal fields are masked.

**Rotating the encryption key:**
1. `npm run keys:generate -- --encryption-version 2`, then append the output to `ENCRYPTION_KEYS`.
2. Set `ENCRYPTION_ACTIVE_KEY_VERSION=2` and restart. New writes now use key 2.
3. `npm run crypto:rotate` re-encrypts old values in batches. Run `npm run crypto:rotate -- --dry-run` to confirm 0 remain.
4. Remove key 1 from `ENCRYPTION_KEYS`.

> ⚠ **Back up `ENCRYPTION_KEYS` and `BLIND_INDEX_KEY` separately from the database.** Without them, encrypted personal data can't be recovered.

## 6. Seed data and test accounts

`npm run db:seed` (or `npx prisma db seed`) runs [prisma/seed.ts](prisma/seed.ts):
- It runs as the owner role, truncates every table, then inserts fresh data.
- It's safe to re-run, and uses a fixed faker seed (`20261002`), so names and amounts are identical every run. Dates are relative to the day you seed.
- Personal fields are encrypted with the same module the app uses.

| Gym | Slug | Plan | Status | Members |
|---|---|---|---|---|
| Iron Temple Fitness | `iron-temple` | Pro | Active | 190 (2 locations) |
| Pulse Fitness Studio | `pulse-fitness` | Starter | Active | 95 |
| Zen Strength Collective | `zen-strength` | Growth | Trial (14 days) | 120 |

Each gym also gets:
- 5–6 membership plans
- Active, expired and frozen memberships
- 6 months of payments, including overdue and refunded ones
- 6 months of check-ins with realistic morning and evening peaks
- 4 weeks of classes with bookings and waitlists
- Staff shifts, trainer clients, notifications and audit log entries

**Test logins:**

| Email | Password | Gym | Role |
|---|---|---|---|
| `superadmin@fitcrm.example` | `SuperAdmin#2026` | (platform) | Super Admin |
| `priya.nair@fitcrm.example` | `GymStaff#2026` | iron-temple / zen-strength | Trainer / **Manager** (gym switching) |
| `owner@irontemple.example` | `GymStaff#2026` | iron-temple | Owner |
| `manager1@irontemple.example`, `manager2@irontemple.example` | `GymStaff#2026` | iron-temple | Manager |
| `frontdesk1@irontemple.example`, `frontdesk2@irontemple.example` | `GymStaff#2026` | iron-temple | Front desk |
| `trainer1@irontemple.example` … `trainer4@irontemple.example` | `GymStaff#2026` | iron-temple | Trainer |
| `owner@pulsefitness.example` | `GymStaff#2026` | pulse-fitness | Owner |
| `manager1@pulsefitness.example` | `GymStaff#2026` | pulse-fitness | Manager |
| `frontdesk1@pulsefitness.example`, `frontdesk2@pulsefitness.example` | `GymStaff#2026` | pulse-fitness | Front desk |
| `trainer1@pulsefitness.example` … `trainer3@pulsefitness.example` | `GymStaff#2026` | pulse-fitness | Trainer |
| `owner@zenstrength.example` | `GymStaff#2026` | zen-strength | Owner |
| `manager1@zenstrength.example` | `GymStaff#2026` | zen-strength | Manager |
| `frontdesk1@zenstrength.example`, `frontdesk2@zenstrength.example` | `GymStaff#2026` | zen-strength | Front desk |
| `trainer1@zenstrength.example` … `trainer4@zenstrength.example` | `GymStaff#2026` | zen-strength | Trainer |

## 7. Tests

| Command | What it runs |
|---|---|
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:unit` | Business rules, encryption, env validation, password hashing, redaction |
| `npm run test:integration` | RLS and tenant isolation against a real PostgreSQL (`gym_saas_test`), through the restricted `gym_app` role |
| `npm run test:e2e` | Playwright against `next dev` on port 3100 (its own `.next-e2e` build directory, so it can run alongside `npm run dev`), using `gym_saas_test` reset and seeded per run |

The test databases are rebuilt from migrations on every run. The suites refuse any database whose name doesn't end in `_test`, so your dev data is never touched. First time only: `npx playwright install chromium`.

## 8. Backups and restore

Back up the database (custom format, compressed). Run as the owner role:

```bash
pg_dump -h localhost -U postgres -d gym_saas -n "gym-admin-portal" -Fc -f gym_saas_$(date +%Y%m%d_%H%M).dump
```

Restore into an empty database:

```bash
createdb -h localhost -U postgres gym_saas_restore
psql     -h localhost -U postgres -d gym_saas_restore -c 'CREATE SCHEMA "gym-admin-portal"'
pg_restore -h localhost -U postgres -d gym_saas_restore --no-owner --role=postgres gym_saas_YYYYMMDD_HHMM.dump
# then point MIGRATION_DATABASE_URL/DATABASE_URL at it and re-apply role + grants:
npm run db:setup-roles && npm run db:grants
```

Notes:
- The dump contains **ciphertext** for personal fields. Restoring it is only useful with the matching `ENCRYPTION_KEYS` and `BLIND_INDEX_KEY`, so store those in your secrets manager, not next to the dump.
- RLS policies, functions and triggers are part of the dump. Roles and grants are not, which is why the last step re-applies them.
- For production, schedule `pg_dump` daily (Windows Task Scheduler or cron), keep at least 30 days, test a restore regularly, and consider WAL archiving / PITR.

## 9. Project structure

```
prisma/              schema, migrations (incl. RLS), sql/ role + grants, seed/
scripts/             db.ts (roles/migrate/reset), generate-keys.ts, crypto-rotate.ts, jobs-run.ts
src/app/             routes: (auth)/login + signup, select-gym, g/[gymSlug]/…, api/
src/server/          server-only code: env, db (RLS context), auth, crypto, security, audit, services
src/domain/          pure business rules (permissions, subscription access, money, slugs, …)
src/lib/             client-safe helpers and shared Zod schemas
src/components/      shadcn/ui and layout components
tests/               unit/, integration/ (real Postgres), e2e/ (Playwright), support/
docs/DESIGN.md       approved architecture
```
