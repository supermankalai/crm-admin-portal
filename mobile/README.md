# FitCRM mobile app

This is the Expo app (SDK 57, React Native 0.86, TypeScript strict) for gym staff, trainers and members. It talks only to the FitCRM backend's mobile API (`/api/mobile/v1`), using the shared contract in [`../packages/shared`](../packages/shared). The design is in [docs/MOBILE_DESIGN.md](../docs/MOBILE_DESIGN.md).

> **Status:** mobile Phase 3 of 7. Done so far:
> - sign-in, biometric lock, gym switching, branding, and tabs by role;
> - **member features**: the card with a live check-in QR, membership details, class booking and waitlist, attendance history, and payments and invoices.
>
> The staff, trainer, workout and progress tabs are placeholders until their phase.

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
- Expo Go (install the version for **SDK 57**) runs everything in this phase.
- **Face ID** is the exception: Expo Go can't use it on iPhone, so the app lock falls back to your passcode there.
- Fingerprint unlock on Android works in Expo Go.
- A development build has real Face ID and, from Phase 6, push notifications:
  - in the cloud, with `npx eas-cli@latest build --profile development` (set up in Phase 7);
  - locally, with `npx expo run:android` (needs Android Studio).

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
