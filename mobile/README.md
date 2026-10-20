# FitCRM mobile app

This is the Expo app (SDK 57, React Native 0.86, TypeScript strict) for gym staff, trainers and members. It talks only to the FitCRM backend's mobile API (`/api/mobile/v1`), using the shared contract in [`../packages/shared`](../packages/shared). The design is in [docs/MOBILE_DESIGN.md](../docs/MOBILE_DESIGN.md).

> **Status:** mobile Phase 6 of 7. Done so far:
> - sign-in, biometric lock, gym switching, branding, and tabs by role;
> - **member features**: the card with a live check-in QR, membership details, class booking and waitlist, attendance history, payments and invoices, **workout plans, marking workouts done, measurements with a chart, and private progress photos**;
> - **front desk, owner and manager features**: QR check-in scanner, dashboard, member search and profiles, add member, sell memberships, record payments, alerts, and the class overview;
> - **trainer features**: schedule (classes, PT sessions, shifts), class attendance, clients with progress, photos and private notes, workout plans and templates, and PT session booking;
> - **for everyone**: a notification inbox (unread count on the More tab), push alerts with per-category settings, and gym announcements; for members, editing contact details and asking for account deletion.
>
> Phase 7 adds the security review, Maestro end-to-end tests and EAS builds.

## Running it

**1. Start the backend so your phone can reach it.** In the repository root:

```bash
npm run dev:lan        # Next.js on 0.0.0.0:3000
ipconfig               # note your Wi-Fi adapter's IPv4 address, e.g. 192.168.1.20
```

Allow inbound **TCP 3000** in Windows Defender Firewall for **Private** networks, and make sure your Wi-Fi is set to *Private*. Check by opening `http://<IPv4>:3000/api/mobile/v1/openapi.json` in your phone's browser.

**2. Point the app at it.** Create `mobile/.env.development.local`. It's gitignored and overrides `.env.development`.

```bash
# Physical phone on the same Wi-Fi
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
# Android emulator: http://10.0.2.2:3000     iOS simulator (macOS only): http://localhost:3000
```

**3. Install and start.**

```bash
cd mobile
npm install
npx expo start         # scan the QR code with Expo Go (Android) or the Camera app (iOS)
# npx expo start --android   (Android emulator)
```

**Expo Go vs a development build:**
- Expo Go (install the version for **SDK 57**) runs everything in this phase, including the camera scanner.
- **Face ID** is the exception: Expo Go can't use it on iPhone, so the app lock falls back to your passcode there.
- Fingerprint unlock on Android works in Expo Go.
- A development build has real Face ID and **push alerts on the phone**:
  - in the cloud, with `npx eas-cli@latest build --profile development` (set up in Phase 7);
  - locally, with `npx expo run:android` (needs Android Studio).
- **Push alerts need two things:** a development or production build (Expo Go on Android can't receive remote push since SDK 53), and `EAS_PROJECT_ID` set when you build. Both come in Phase 7.
  - Until then, everything still lands in **More → Notifications**.
  - To see exactly what a phone *would* show, run `npm run jobs:watch` in the root and open the `.dev-outbox/*.push.json` files.

**Test logins** (from `npm run db:seed` in the root):

| Login | Password | What you'll see |
|---|---|---|
| `member1@irontemple.example` | `Member#2026` | Member tabs at Iron Temple |
| `alex.member@fitcrm.example` | `Member#2026` | Gym picker (Iron Temple and Zen Strength) and switching |
| `+919800000022` | `Member#2026` | Phone login; or tap *Email or text me a code*, and the code is in `.dev-outbox/*.sms.txt` |
| `member1@pulsefitness.example` | `Member#2026` | Gym shown as "not in this gym's plan" (Starter) |
| `owner@irontemple.example` | `GymStaff#2026` | Owner tabs |
| `frontdesk1@irontemple.example` | `GymStaff#2026` | Front-desk tabs |
| `trainer1@irontemple.example` | `GymStaff#2026` | Trainer tabs |
| `priya.nair@fitcrm.example` | `GymStaff#2026` | Trainer at Iron Temple, Manager at Zen Strength |

**Member features to try** (as `member1@irontemple.example`):
- **My card:** the QR code changes every 30 seconds. Screenshots are blocked on the card, and the screen brightens while it's open.
  - To check in with it, open the web portal's **Check-in** page as `frontdesk1@irontemple.example` and use **Scan with camera** (Chrome) on your phone's screen.
  - A second scan of the same code, or of a screenshot, is refused. Under Settings → Member app, an owner can stop accepting printed codes.
- **Classes:** book, see "Booked" or your waitlist number, and cancel or leave the waitlist. A booked spot can't be cancelled less than 2 hours before the class (the default, set per gym in Settings → Member app).
- **More → My membership, Attendance, Payments & invoices.**

**Staff features to try:**
- **Front desk** (`frontdesk1@irontemple.example`):
  - Open the **Check-in** tab, tap *Scan with camera*, and point it at a member's live card. The card can be on a second phone signed in as `member1@irontemple.example`.
  - The result fills the screen: green for allowed, red with the reason otherwise. Scanning the same code again is refused as already used.
  - You can also search by name or member number.
- **Members tab:**
  - search and filter;
  - open a profile, then record a payment on an open invoice or sell a membership;
  - *Add member*, then *Save and sell membership*, for a quick sign-up;
  - *Invite to the member app* with a code, which the member enters under *I have an invite*.
- **Owner** (`owner@irontemple.example`):
  - **Dashboard** shows check-ins, revenue today and this month, active members, expiring memberships, overdue payments and today's classes. *Check in a member* opens the scanner.
  - **Alerts** lists expiring memberships, overdue invoices and full classes.
  - The front desk sees no revenue.
- **Classes** (any staff): the next 7 days with booking numbers. Tap a class for its booking list and waitlist. Trainers see only their own classes.

**Trainer and fitness features to try** (`trainer1@<gym domain>` coaches `member1@<gym domain>` in every seeded gym):
- **Trainer** (`trainer1@irontemple.example`):
  - **Schedule** lists your classes, PT sessions and shifts for the next 7 days. Tap a PT session to mark it done, a no-show, or cancelled.
  - In a class you teach, mark each booking *Attended* or *No-show*. This is open from 30 minutes before the class until a day after.
  - **Clients**: open `member1`'s profile to see their measurements chart, progress photos, workouts done, plans, PT sessions and your private notes. *Book PT* refuses times that clash with your classes or sessions. *New plan* writes a plan for that client.
  - **Plans**: a template ("Beginner full body"). *Give to a client* copies it to a client as their active plan; *Edit* changes days and exercises.
- **Member** (`member1@irontemple.example`):
  - **Workouts**: your trainer's plan, day by day. *Mark as done*, optionally with a note your trainer can read. Upcoming PT sessions are shown at the top.
  - **Progress**: *Log measurements* (weight, body fat, chest, waist, hips, arm, thigh). Tap an entry to edit or delete it. The chart switches between measurements; press and drag to read the values.
  - **Photo**: take or choose a progress photo. Its location and other metadata are removed, and only you and your trainers can see it. Screenshots are blocked in the photo viewer.
- **Owners and managers** can read any client's measurements and trainer notes through the API, but never their photos. Their screens for this come with the web portal additions in Phase 6.

**Notifications, announcements and profile to try:**
- Keep `npm run jobs:watch` running in the root. Every minute it creates reminders and alerts and "sends" push alerts: to `.dev-outbox/*.push.json`, or to real phones with `PUSH_PROVIDER=expo`.
- **Member** (`member1@irontemple.example`):
  - **More → Notifications** shows the inbox, already seeded with a class reminder, a waitlist promotion, a payment reminder and announcements. Tap one to open its screen. The More tab shows the unread count.
  - Book a class starting within 2 hours and a class reminder appears on the next run.
  - **More → Alerts on this phone:** turn categories on or off. *Turn on alerts* asks for permission (in a development build).
  - **More → Announcements:** news from the gym.
  - **More → My details:** edit your phone, email, address and emergency contact.
  - **Delete my account** sends a request. The gym handles it on the web under Members → *1 deletion request*.
- **Owner on the web** (`owner@irontemple.example`):
  - **Announcements** in the side menu: publish one to members and it appears in the app straight away. The next jobs run pushes its title.
  - **Members → a member → Member app:** invite by email, SMS or a front-desk code, or turn their app access off.
  - **Workout plans** in the side menu: every trainer's plans, templates, editing and giving plans to clients.
- **Waitlist:** sign in as two members. Fill a class with the first and join its waitlist with the second. When the first cancels, the second gets "You're in!".

To try an invite, tap *I have an invite from my gym* and enter `WELC-OME2`.

**To see a logo:** sign in to the web portal as `owner@irontemple.example`, go to Settings → Branding, upload a logo, then reopen the gym in the app.

## Scripts

| Command | What it does |
|---|---|
| `npx expo start` | Dev server (Expo Go / development build) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | `expo lint` (ESLint with the React Compiler rules) |
| `npm test` | Jest + React Native Testing Library |
| `npx expo export --platform android` | Production bundle (checks that everything resolves) |
| `npx expo-doctor` | Dependency and config checks |

## How it's built

- **Routes** live in `src/app` (Expo Router):
  - `(auth)` holds login, one-time code and invite;
  - `select-gym` is the gym picker;
  - `(app)` holds the tabs.
  - Each route group is a `Stack.Protected` route; tabs for other roles are `Tabs.Protected`, so they can't even be deep-linked. The server checks every request anyway.
- **Session** ([src/lib/session.ts](src/lib/session.ts)):
  - The access token is kept in memory only, and the refresh token in SecureStore only.
  - Only one refresh runs at a time; a second parallel refresh would look like token reuse and the server would sign the device out.
  - Revocation and expiry sign out locally and wipe every cache.
  - Switching gyms removes the previous gym's cached data.
- **Offline:** TanStack Query persists recent results to AsyncStorage, never tokens, and never queries marked `sensitive`. The app opens instantly with the last known data and shows an offline banner. Actions that need the server are disabled with a message.
- **Security:**
  - Only development builds may use plain HTTP; staging and production refuse to start without HTTPS.
  - Production builds strip every `console` call.
  - Android backup is off.
  - The app bundle contains no secrets, only the public API URL.
- **Environments:** `APP_ENV=development|staging|production` (EAS build profiles in Phase 7) sets the app name, the bundle id and HTTP cleartext. `EXPO_PUBLIC_API_URL` comes from `.env.<env>` / `.env.<env>.local`.
