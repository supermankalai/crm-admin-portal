# FitCRM Mobile: design (approved)

This document covers the staff, trainer and member mobile app, built on the existing Next.js backend and the same PostgreSQL database. **No code has been written yet.** This is Step 0 of the request: what we reuse, the structure plan, new tables, RLS, the API, the auth flow and the screens. Decisions that need your input are marked **[DECIDE]** and collected in §11.

---

## 1. What already exists and will be reused (not duplicated)

| Existing piece | Where | How mobile uses it |
|---|---|---|
| RLS context (`withTenant`/`withUser`/`inTenant`, `SET LOCAL app.current_gym_id`) | `src/server/db/*`, `src/server/tenant/guards.ts` | Every mobile endpoint runs through it. The app role stays `gym_app` (no BYPASSRLS). |
| `TenantContext` from `resolveTenant()` (session + membership check, 404 for other gyms) | `src/server/tenant/resolve.ts` | Staff tokens resolve the **same** context. A new `MemberContext` is built the same way from the member link. |
| Permission matrix (`OWNER/MANAGER/FRONT_DESK/TRAINER`) | `src/domain/permissions.ts` | Unchanged for staff. A separate, small member permission set is added. |
| Plan limits and feature flags (`assertFeature`, `assertWithinLimit`, `enforce_plan_limits` trigger) | `src/server/plan/limits.ts`, DB | Reused, plus two new flags: `mobileApp` and `memberApp`. |
| Read-only mode (`assertWritable`, subscription access) | `src/domain/subscription-access.ts` | Same rules. The API returns `access` so the app can show the banner. |
| **Services**: members, memberships, sell/payments/refunds, check-in, classes/bookings/waitlist, staff, dashboard, reports, notifications | `src/server/services/**` | Mobile route handlers are **thin adapters** over these functions. No business logic is copied into the API or the app. |
| Zod schemas | `src/lib/validation/*` | Moved into the shared package (§2) and used by the server, the web forms and the mobile forms. |
| Pure domain rules (money, dates, membership state, check-in decision, booking placement, staff rules) | `src/domain/*` | Moved into the shared package too. The app uses them for display only; the server always decides. |
| Encryption (AES-256-GCM with AAD, key versions, blind index) | `src/server/crypto` | New sensitive fields use `encryptField`/`tryDecrypt`. Phone login uses the blind index. |
| Audit (`recordAudit`, `recordPlatformAudit`, append-only) | `src/server/audit/*` | Every sensitive mobile action is written there. |
| Rate limiting (Postgres buckets, `TRUSTED_PROXY_HOPS`) | `src/server/security/*` | New rules for token login, OTP, invite redemption and refresh. |
| Storage (`StorageProvider`, magic-byte image checks, per-gym keys) | `src/server/storage` | Progress photos reuse it. Signed URLs are added (§6). |
| Notifications (`generateGymNotifications`, `NotificationChannel`, dedupe keys) | `src/server/notifications` | A new **Expo push channel** is added next to in-app. Member alerts are added too. |
| Email (`EmailProvider`, dev outbox) | `src/server/email` | Member invites. SMS gets the same interface with a dev outbox. |
| Hashed single-use tokens (invitations: sha256, `SECURITY DEFINER` accept function) | staff invitations | The same pattern is used for member invites, OTP codes and refresh tokens. |

**Existing code that changes (small, deliberate):**
- **Class booking lock.** Booking locks the class with `SELECT … FOR UPDATE`. Postgres only allows that to roles that may update the row, and members must never update a class. I'll switch to a per-class **transaction advisory lock** (`pg_advisory_xact_lock(hashtext('session:'||id))`). It gives the same "no overbooking" guarantee for every actor and keeps one booking implementation. The existing 20-concurrent-bookings test must still pass.
- **Booking services take an "actor".** They accept *staff* (today) or *member* (books only themselves, under the gym's member-booking rules), so there is still a single code path.

---

## 2. Project structure **[DECIDE]**

### Option A: no file moves *(recommended)*

```
crm-admin-portal/                 ← unchanged: the Next.js app stays at the root
├─ package.json                   ← add "workspaces": ["mobile", "packages/*"]
├─ src/ prisma/ tests/ …          ← unchanged (imports keep working, see below)
├─ packages/shared/               ← NEW: @fitcrm/shared
│  └─ src/{domain,validation,api}/   domain rules + Zod schemas + OpenAPI types + typed client
└─ mobile/                        ← NEW: Expo app (Expo Router, NativeWind, TanStack Query)
```

- `src/domain/*` and `src/lib/validation/*` move into `packages/shared/src/…`. These are pure files with no server imports.
- `tsconfig` path aliases keep `@/domain/*` and `@/lib/validation/*` pointing at the new location, so **no import in the web app changes**. The web build, Vitest and Playwright keep their current paths.
- **Pros:** the smallest change to working code. The web app, its scripts, `prisma.config.ts`, CI paths and the e2e setup stay where they are.
- **Cons:** the root is both the web app and the workspace root, which is slightly less tidy than `apps/web`. React versions need care (next point).

### Option B: a full `apps/web` + `apps/mobile` + `packages/shared` monorepo

- **Pros:** the conventional layout, and the clearest boundaries.
- **Cons:** every web file moves, and these all need changing: scripts, the Prisma paths, `tsconfig`, Vitest and Playwright configs, `.env` loading, the e2e `NEXT_DIST_DIR` setup and the README. A large diff with real regression risk, for no functional gain.

### React and dependency note (both options)

The web app uses React 19.2 (Next 16). The latest Expo SDK pins its own React and React Native versions. With npm workspaces, two React copies can clash when they're hoisted.
- **Mitigation:** `mobile/` pins its React version, and Metro is configured for the monorepo (`watchFolders` plus `disableHierarchicalLookup`).
- **Fallback, if hoisting still conflicts:** `mobile/` is installed standalone and depends on `packages/shared` via `file:`.

I'll verify the versions with `create-expo-app@latest` at the start of Phase 2 and report which way it went.

**Shared package rule:** `@fitcrm/shared` contains no server code (no Prisma, crypto or env) and no React. It is imported by the server, the web client components and the mobile app.

---

## 3. Identity model: who logs in

- **`User` stays the single global identity**, for staff and members alike. One person has one login and can be a trainer at gym A and a member at gym B. Gym switching works the same way for everyone.
- **Staff in a gym**: the existing `StaffMember` row (role OWNER/MANAGER/FRONT_DESK/TRAINER).
- **Member in a gym**: a new `MemberAccount` row that links `User` to an existing `Member` record in that gym.

**Changes to `User` [DECIDE]**
- `email` becomes **optional**, and new fields are added: `phoneEnc` (encrypted), `phoneBlindIndex` (unique) and `kind`.
- A CHECK constraint requires either an email or a phone.
- This lets a member invited by SMS log in by phone and one-time code.
- **Alternative:** keep email required and use SMS only to deliver the invite link. That's simpler, but members without email can't use the app.

**Member invitation (three ways), all through one hashed, single-use, expiring token:**
1. **Email link:** `…/app/invite/<token>`, a universal link that opens the app (or the web fallback page). Valid for 7 days.
2. **SMS link:** the same link sent by SMS. Dev writes SMS to `.dev-outbox/` like email; production needs an SMS provider **[DECIDE]**.
3. **Front-desk code:** an 8-character code shown on the staff screen, valid for 30 minutes, which the member types into the app.

**Redeeming an invite** means setting a password, or verifying a one-time code first, through a `SECURITY DEFINER` function like `invitation_accept`. It creates or links the `User`, creates the `MemberAccount`, marks the invite used and writes an audit entry.

**One-time-code login (members):**
- 6 digits, 5-minute expiry, single use.
- Stored only as an HMAC hash.
- At most 5 tries per code, plus rate limits per identifier and per IP.
- Sent by email or SMS.

---

## 4. Mobile authentication flow

```
POST /auth/login {email|phone, password, device}       → 200 {accessToken(15m), refreshToken, gyms[]}
POST /auth/otp/request {email|phone}                    → 202 (always, no account enumeration)
POST /auth/otp/verify {email|phone, code, device}        → 200 tokens
POST /auth/invite/redeem {token|code, password?, device} → 200 tokens
POST /auth/refresh {refreshToken}                        → 200 new pair (rotation)
POST /auth/select-gym {gymSlug}                          → 200 gym-scoped accessToken
POST /auth/logout                                        → revokes this device session + its push tokens
```

- **Access token:** a JWT signed with a **separate** `MOBILE_JWT_SECRET` (HS256). It lasts 15 minutes and carries:
  - `sub` (userId) and `sid` (device session id);
  - `sv` (the user's `sessionVersion`, so the web's "sign out everywhere" and password change also kill mobile sessions);
  - after gym selection, `gid` (gymId) and `ctx` (`staff` or `member`).
- **Every request** re-checks, in the database:
  - the device session is active and `sv` matches;
  - the user is still active staff, or still has an active member account, in that `gid`.

  Removing someone from a gym therefore takes effect on their next request, exactly like the web. The gymId comes **only** from the verified token plus that membership check, never from the body or query.
- **Refresh token:** 32 random bytes, stored as a SHA-256 hash in `MobileRefreshToken`, tied to a `MobileDeviceSession`. Rotation and reuse detection work like this:
  - Each use marks the token `usedAt` and issues a new one in the same *family*.
  - Presenting a token that was **already used** revokes the **whole device session**, the "reuse detection" you asked for. It's audited as `mobile.refresh_reuse`.
  - Refresh tokens expire after 30 days of inactivity, with an absolute limit of 90 days.
- **Devices:**
  - `MobileDeviceSession` stores the device name, platform, app version, created and last-seen times, and IP.
  - Users list and revoke their devices (`GET/DELETE /me/devices`). Revoking a device also deletes its push tokens.
- **Gym switching:** `POST /auth/select-gym` returns a new access token for the chosen gym after the membership check. The app clears that gym's query cache.
- **Biometric unlock:** this is on-device only. The refresh token sits in SecureStore, behind `requireAuthentication` where the platform supports it. After a configurable time in the background, the app shows a lock screen and needs Face ID or fingerprint to read the token again. The server never sees biometrics.

---

## 5. New database tables

All tenant tables get `gymId`, an index on it, composite `(gymId, id)` foreign keys, `timestamptz` columns, the `forbid_gym_change` trigger, and RLS ENABLE plus FORCE. The existing isolation-matrix test picks them up automatically.

| Table | Purpose | Notes |
|---|---|---|
| `MemberAccount` | Links `User` ↔ `Member` in a gym | unique `(gymId, memberId)` and `(gymId, userId)`; status ACTIVE/DISABLED |
| `MemberAppInvite` | Email/SMS link or front-desk code | `tokenHash`, `channel`, `expiresAt`, `usedAt`, `revokedAt`, `createdById` |
| `LoginOtp` *(platform)* | One-time codes | `identifierHash`, `codeHash`, `attempts`, `expiresAt`, `usedAt`. Reachable only via SECURITY DEFINER functions. |
| `MobileDeviceSession` *(platform, per user)* | A logged-in device | name, platform, appVersion, lastSeenAt, revokedAt, revokeReason |
| `MobileRefreshToken` *(platform)* | Rotating refresh tokens | `tokenHash` unique, `sessionId`, `familyId`, `usedAt`, `expiresAt`. App role has no SELECT; access only via functions. |
| `PushToken` | Expo push token per device per gym | `gymId`, `userId`, `deviceSessionId`, `token`, `invalidatedAt` |
| `NotificationPreference` | Per user, per gym, per category | class reminders, waitlist, membership, payments, announcements |
| `WorkoutPlan` | Created by a trainer, assigned to a member | title, notes (encrypted), `trainerId`, `memberId`, status |
| `WorkoutPlanDay` / `WorkoutExercise` | Structure | exercise name, sets, reps, rest seconds, notes, order |
| `WorkoutCompletion` | The member marks a workout done | `planDayId`, `completedAt`, optional note (encrypted) |
| `ProgressEntry` | Weight and measurements | `recordedOn`, `measurementsEnc` (all values encrypted as one JSON blob) |
| `ProgressPhoto` | A progress photo | `fileId` → FileAsset (new kind `PROGRESS_PHOTO`); `takenOn`. The storage key is never sent to clients. |
| `TrainerClientNote` | Private trainer notes | `bodyEnc`. Visible only to the authoring trainer and managers. |
| `Announcement` | Gym announcements | title, body, audience (all / members / staff), `publishedAt`, `createdById` |
| `AccountDeletionRequest` | A member asks for deletion | status REQUESTED/COMPLETED/REJECTED. Staff process it (anonymise the Member, disable the account), and it's audited. |
| `TrainingSession` *(optional, [DECIDE])* | Personal training appointments | Needed for "My schedule: personal training sessions"; the current schema has none. |

**Changes to existing tables:**
- `PlatformPlan`: add `featureMobileApp` and `featureMemberApp` (Boolean).
- `FileKind`: add `PROGRESS_PHOTO`.
- `Notification`: add new types (CLASS_REMINDER, WAITLIST_PROMOTED, PAYMENT_DUE, ANNOUNCEMENT, CLASS_FULL).
- `User`: the identity changes in §3.

---

## 6. RLS policies (new and changed)

**New session setting `app.current_member_id`.** It is set only by the server after the member check. The helper `app_current_member_id()` validates it against `MemberAccount` (current user, current gym, ACTIVE), so a forged setting gives nothing.

**Member-context access** (when the request is a member, there is no staff row, so `app_is_staff_of_current_gym()` is false and every existing staff write policy already refuses):

| Table | Member may… |
|---|---|
| `Member` | read **own** row. Update contact and emergency fields **only** through `member_update_own_contact()` (SECURITY DEFINER, column-limited, audited). |
| `Membership`, `MembershipFreeze`, `Invoice`, `Payment`, `Refund`, `CheckIn` | read **own** rows |
| `ClassSession`, `ClassType`, `Room`, `Location`, `OpeningHours`, `MembershipPlan` (active) | read the gym's schedule and catalogue |
| `Booking` | read own. Insert and update own rows only (`memberId = app_current_member_id()`). |
| `Membership` (class credits) | changed only by the booking functions. The member has no direct UPDATE policy. |
| `WorkoutPlan*` | read plans **assigned to them** |
| `WorkoutCompletion`, `ProgressEntry`, `ProgressPhoto` | read and write **own** rows |
| `Announcement` | read published ones for their audience |
| `Notification`, `NotificationPreference`, `PushToken` | own rows (the existing recipient-only policy) |
| everything else (staff, notes, other members, audit, reports…) | **nothing** |

**Trainer access to client data:**
- Trainers read `ProgressEntry`, `ProgressPhoto`, `WorkoutCompletion` and `WorkoutPlan` only for members in their `TrainerClient` assignments (`app_is_trainer_of(memberId)`).
- Managers and owners can read everything in their gym.
- `TrainerClientNote` is readable by its author plus managers and owners.
- Progress photos are "private to the member and their assigned trainer". **[DECIDE]** Should managers and owners see them too? My default is **no**: member plus assigned trainers only.

**Platform tables** (`MobileDeviceSession`, `MobileRefreshToken`, `LoginOtp`) follow the existing `PasswordResetToken` pattern. The app role can't read them directly; it goes through narrow SECURITY DEFINER functions (`mobile_refresh_rotate`, `otp_issue`, `otp_verify`, `member_invite_redeem`), each with a pinned `search_path` and no PUBLIC EXECUTE. The isolation-matrix and catalog tests already enforce this.

**Signed file URLs:**
- `GET /api/mobile/v1/files/<fileId>?exp=…&sig=…`, with an HMAC over `fileId|userId|gymId|exp` and a lifetime of 5 minutes.
- The handler checks the signature **and** re-runs the permission check before streaming. A leaked URL is useless to anyone else, and expires anyway.

---

## 7. Mobile API: `/api/mobile/v1`

**Conventions (every endpoint):**
- **Requests:** a Bearer access token, except for the auth endpoints. Bodies and queries are validated with the shared Zod schema.
- **Errors:** `{ error: { code, message, fieldErrors? } }`, with status 400, 401 (token), 403, 404, 409, 402 (plan feature or limit), 423 (gym read-only) or 429.
- **Lists:** cursor pagination with `?cursor=&limit=` (at most 50).
- **Plan flags:** `mobileApp` is required for staff use and `memberApp` for members.
- **Spec and client:** `/api/mobile/v1/openapi.json` is generated from the Zod schemas (`zod-openapi`), and `@fitcrm/shared/api` holds the typed client generated from it.

**Auth and session:** the endpoints in §4, plus
- `GET /me` (profile and gyms with role and branding);
- `GET|DELETE /me/devices[/:id]`;
- `POST /me/password` (bumps `sessionVersion`);
- `PUT /me/notification-preferences`;
- `POST|DELETE /me/push-tokens`;
- `POST /me/deletion-request`.

**Shared by every role:**
- `GET /gym` (branding: name, colour, logo signed URL, access state, timezone, currency);
- `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`;
- `GET /announcements`.

**Member (`ctx=member`):**

| Method + path | Notes |
|---|---|
| `GET /member/card/qr` | Returns `{ token, expiresAt }`. The token is valid for **45 s**, see below. |
| `GET /member/membership` | Plan, status, dates, freeze, credits, renewal hint |
| `GET /member/classes?from=&to=` | Gym schedule with "booked / waitlisted / full" status for me |
| `POST /member/classes/:sessionId/book` | Same booking service; spot or waitlist; `409` when full and the waitlist is off |
| `DELETE /member/bookings/:bookingId` | Cancellation within the gym's rules; returns credit |
| `GET /member/attendance`, `GET /member/payments`, `GET /member/invoices/:id` | Own records only |
| `GET /member/workouts`, `POST /member/workouts/:dayId/complete` | Assigned plans |
| `GET|POST /member/progress`, `POST /member/progress/photos` (multipart), `GET /member/progress/photos` | Charts data and signed photo URLs |
| `PATCH /member/profile` | Contact and emergency fields only (encrypted) |

**Rotating QR code:**
- The payload is `FCM2.<gymId>.<memberId>.<exp>.<nonce>.<hmac>`. The HMAC uses a server key with the gym and member bound in, and `exp` is now + 45 s.
- The app refreshes it every 30 s.
- At check-in the server verifies the signature, checks expiry with 5 s of clock skew, and checks the gym matches the scanner's gym.
- The nonce is single-use within its lifetime (a 60 s replay cache in `RateLimitBucket`-style storage).
- A screenshot stops working within a minute and can't be reused once scanned.
- The printed static `FITCRM:` codes from Phase 4 keep working by default. **[DECIDE]** Should a gym be able to turn them off?

**Front desk / manager / owner (`ctx=staff`, existing permission checks):**

| Method + path | Reuses |
|---|---|
| `POST /staff/check-in` `{ qr }` or `{ memberId }` | `checkin` service (decision, audit, re-scan guard); also accepts rotating member QR |
| `GET /staff/members?q=&status=&cursor=`, `GET /staff/members/:id` | members list and profile services (decryption, trainer visibility) |
| `POST /staff/members`, `POST /staff/members/:id/app-invite` | createMember, plus the new invite service |
| `POST /staff/payments`, `POST /staff/memberships/sell` | billing services (row locks, tax, audit) |
| `GET /staff/dashboard` | `getDashboard` (financials only with `dashboard.financials`) |
| `GET /staff/alerts` | expiring, overdue and full-class items, from notifications plus live queries |
| `GET /staff/classes?from=&to=`, `GET /staff/classes/:id` | class sessions services |

**Trainer (`ctx=staff`, role TRAINER, own classes and clients only):**

| Method + path | Notes |
|---|---|
| `GET /trainer/schedule` | Shifts, own classes (and PT sessions if approved) |
| `GET /trainer/classes/:id`, `POST /trainer/bookings/:id/attendance` | `markAttendance` (same time window) |
| `GET /trainer/clients`, `GET /trainer/clients/:memberId` | Assigned clients only; attendance, progress, photos (signed URLs) |
| `GET|POST /trainer/clients/:memberId/notes` | Encrypted private notes |
| `GET|POST|PATCH /trainer/workout-plans`, `POST /trainer/workout-plans/:id/assign` | Plans and exercises |

**Rate limits:**
- `login`, `otp/request` (per identifier and per IP), `otp/verify` (per code and per IP), `invite/redeem` (per IP and per code), `refresh` (per device session) and `password`.
- All reuse the Postgres buckets.

**Audit:**
- Platform audit: logins, OTP issue and verify, refresh reuse, device revocation and password change.
- Tenant audit: check-ins, bookings, payments, member invites, workout plans, progress-photo access by trainers, announcements and deletion requests.
- Audit entries never include tokens, codes or measurements.

---

## 8. Screens by role (bottom tabs change by role)

**Shared:**
- Login: email or phone plus password, or a one-time code; "I have an invite code".
- Gym picker and switcher in the header.
- Biometric lock screen and offline banner.
- A read-only banner for staff, and a friendly message for members, when the gym's subscription is expired or suspended.
- Profile: contact details, emergency contact, password, devices, notification preferences, delete account.

| Role | Tabs |
|---|---|
| **Owner / Manager** | Dashboard · Members (search → profile → record payment / sell / add member / send app invite) · Classes (today / this week, bookings) · Alerts · More (check-in scanner, profile) |
| **Front desk** | Check-in (camera scanner with a full-screen green or red result and the reason, plus manual search) · Members (quick sign-up, payment) · Classes · More |
| **Trainer** | Schedule · Classes (attendance) · Clients (profile, attendance, progress charts and photos, private notes) · Plans (create and assign workouts) · More |
| **Member** | Card (rotating QR, brightness boost) · Classes (book, cancel, waitlist) · Workouts (assigned plans, mark done) · Progress (log weight and measurements, charts, photos) · More (membership, attendance, payments and invoices, announcements, profile) |

**Behaviour across screens:**
- TanStack Query with a persisted cache for the last known data.
- Skeleton loaders, empty states and pull to refresh.
- Actions that need the server (check-in, book, pay) are disabled when offline, with a clear message.
- NativeWind light and dark themes, with the gym's brand colour as the accent (checked for contrast) and its logo in the header.
- Dynamic type, accessibility labels on every control, and 44 pt touch targets.

---

## 9. Security on the device

- Tokens are stored **only** in `expo-secure-store`. The refresh token is biometric-gated when enabled.
- The query cache, persisted to AsyncStorage, holds **no tokens** and no data marked sensitive: measurements, notes and photos are kept in memory only.
- **Clearing data:**
  - On logout or revocation: secure storage, the query cache and push registration are all wiped.
  - On gym switch: only that gym's cached data is wiped.
- Logging goes through a `log()` wrapper that's a no-op in production builds; `babel-plugin-transform-remove-console` strips the rest. Nothing logs tokens, codes or personal data.
- **Environments** (`app.config.ts` + `EXPO_PUBLIC_API_URL` per EAS profile: development, staging, production):
  - Production refuses non-`https` URLs at startup.
  - No secrets in the bundle: only the API URL and the Expo project id.
- Android cleartext HTTP is allowed **only** in the development build, for the LAN IP.

**Push notifications:**
- Expo push tokens are registered per device and per gym, and removed on logout and device revocation.
- `DeviceNotRegistered` receipts invalidate the token.
- Notification text never contains personal data, e.g. "Your membership ends in 3 days", not names or amounts. Opening a notification loads the details over the API.
- Sending goes through the existing `NotificationChannel` pipeline: dedupe keys, preferences respected, and the job queue in `jobs:run`.

---

## 10. Local development, testing and build

**Running on a phone and in emulators:**
- **Physical phone on the same Wi-Fi:**
  - Run `npm run dev:lan`, which is `next dev -H 0.0.0.0`.
  - Set `EXPO_PUBLIC_API_URL=http://<your PC's IPv4>:3000` in `mobile/.env.development`. Find the IPv4 with `ipconfig`.
  - Allow port 3000 through Windows Firewall on the Private profile.
- **Android emulator:** use `http://10.0.2.2:3000`.
- **iOS simulator:** use `http://localhost:3000`. This needs a Mac; on Windows, iOS is limited to a physical iPhone with Expo Go or a development build.
- **Expo Go vs development build:** Expo Go covers most screens. Biometric-gated SecureStore and push notifications need a **development build** (`eas build --profile development`, or a local `npx expo run:android`).

**Tests:**
- **API tests:** Vitest integration tests call the route handlers directly against `gym_saas_test`.
  - Every endpoint gets an authorization matrix: anonymous, member A1, member A2, front desk A, trainer A, and staff B.
  - Specific cases: token refresh, reuse revoking the session, device revocation, QR expiry and replay, the plan flags, and member versus staff isolation.
- **Mobile unit tests:** Jest + RNTL for hooks (auth, gym switch, offline) and key screens.
- **Maestro end-to-end flows**, run against the seeded test backend on an **Android emulator** (Maestro on Windows can't drive iOS):
  - member login and QR;
  - front-desk scan;
  - book and waitlist;
  - trainer attendance;
  - gym switch.

**Build:** `eas.json` with development, preview and production profiles. EAS needs an Expo account, and iOS needs an Apple Developer account **[DECIDE]**.

---

## 11. Decisions (answered)

The decisions as given:
1. **Option A** (no file moves).
2. Phone login: **yes**. SMS provider: **Twilio**.
3. `TrainingSession` table: **yes**, in Phase 5.
4. Progress photos: visible to the **member and their assigned trainers only**.
5. Printed static QR codes: **kept**, with a per-gym switch to turn them off.
6. Booking defaults: **14 days ahead, cancel until 2 hours before**.

What was asked of each decision:

1. **Structure:** Option A (no file moves; `mobile/` and `packages/shared` as workspaces) or Option B (full `apps/web` move)? *I recommend A.*
2. **Phone login:** make `User.email` optional and add an encrypted, blind-indexed phone, so members can sign up and log in by SMS? *I recommend yes.* Also, which SMS provider in production (Twilio, MSG91, …)? Dev uses an outbox either way.
3. **Personal training sessions:** add a `TrainingSession` table, so trainers' schedules include PT appointments and members can see theirs? *I recommend yes, in Phase 5.*
4. **Progress photo visibility:** the member plus assigned trainers only (*recommended*), or managers and owners too?
5. **Static QR codes:** keep the printed `FITCRM:` codes working alongside the rotating app QR (*recommended*, with a per-gym setting to turn them off), or app QR only?
6. **Member booking rules:** members can book up to N days ahead and cancel until X hours before (credit returned), with gym defaults of 14 days and 2 hours, editable in Settings. Are these defaults OK?
7. **Accounts:** confirm you have, or will create, an Expo account (EAS) and, for iOS, an Apple Developer account. These are only needed in Phase 7.

Once these are answered, Phase 1 will deliver:
- the shared package;
- the mobile API foundation (token auth, refresh rotation, devices, member accounts and invites, OTP, the OpenAPI spec and typed client);
- the migrations with RLS and the seed extension;
- the API tests;

all followed by the usual gate (migrate, seed, typecheck, lint, tests, web build).
