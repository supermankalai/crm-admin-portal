# Live sessions (LiveKit)

Online personal training and live group classes, using the gym operator's self-hosted LiveKit
server for video. The app never carries media itself. It decides **who may join which room and
with what rights**, and it issues a short-lived LiveKit token. The browser or phone then connects
straight to LiveKit.

Server code lives under `src/server/services/live/`, shared rules in
`packages/shared/src/domain/live.ts`, the staff web room at `/g/{gym}/live/...`, and the mobile
screens under `mobile/src/app/(app)/live/`.

Nothing is recorded (no Egress) in this version.

## Decisions

1. **"Online" is a property of a session, not a new kind of session.** `ClassSession` and
   `TrainingSession` each gain `deliveryMode`: `IN_PERSON` (default, today's behaviour),
   `ONLINE` or `HYBRID` (classes only: in the room and streamed). An `ONLINE` class has no room,
   so `ClassSession.roomId` becomes nullable, and a check constraint keeps it required for the
   other two modes. Booking, capacity, waitlists, credits, PT packages, reminders and reports
   all keep working unchanged, because an online session is still the same row.
   - The mode is chosen when a class is scheduled or a PT session is booked, and stays fixed.
     To change it, cancel and reschedule.
   - An in-person class's capacity is capped by its room. A hybrid class's isn't, since some
     people join from home.
   - The option appears only when the plan includes live sessions and the server is set up.
2. **One LiveKit room per session, created on demand.** The room name is
   `g_{gymId}__class_{sessionId}` or `g_{gymId}__pt_{sessionId}`. The gym id is part of the name
   and every token is issued after a gym-scoped database check, so one tenant cannot reach
   another's room. Each join token carries the room's settings (`maxParticipants`: class
   capacity + 2, PT = 3; a 5-minute `emptyTimeout`), so LiveKit creates the room on the first
   join and issuing a token needs no call to the server.
3. **The join window opens 10 minutes before start and closes 15 minutes after end.** Outside
   it, or once the session is cancelled, completed or marked no-show, the server issues no
   token. A token lives until the window closes, and at most 3 hours. Cancelling a session
   deletes its room on LiveKit at once, which disconnects everyone. The jobs runner closes rooms
   whose window has closed. A call already in progress continues when the trainer marks the
   session done, until its window closes.
4. **Who may join, and with what rights.** Only the session's own people may join. Owners
   and managers don't join calls; if they also teach the class or run the PT session, they
   join as its trainer.

   | | Class (online/hybrid) | PT session (online) |
   |---|---|---|
   | Session trainer | Host: camera, mic, screen share, mute/remove others | Camera, mic, screen share |
   | Owner, manager, front desk, other trainers | No | No |
   | Member | Only with a `BOOKED` (or checked-in) booking, not waitlisted or cancelled | Only the session's member |

   In classes, members join with camera and mic **off**. They can turn them on, but cannot
   share their screen, and the host can mute or remove them. Classes show a member's first
   name and last initial, not their full name. Version 1 has no text chat, which avoids
   moderation and retention questions.
5. **Attendance comes from LiveKit webhooks.** `POST /api/livekit/webhook`, with its signature
   checked by the LiveKit SDK, records `participant_joined` and `participant_left` in a new
   `LiveAttendance` table (session, member or staff, first join, last leave, total seconds).
   `room_finished` closes everyone still connected. Repeated events are harmless.
   The class roster and the PT session show "joined online · 42 min". For PT, the trainer
   still marks the session done or no-show; the attendance is shown as a hint, not applied
   automatically, so credits never move without a person deciding.
6. **Plan flag and server config.** A new plan flag, `featureLiveSessions`, turns the feature on
   per plan, and the platform admin edits it like the others. On the server it is enabled only
   when `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are set, and they
   are validated in `src/server/env.ts`. Without them, the "Online" option is hidden and the
   join endpoints return 503. The secret is server-only: it is never sent to a client and never
   logged.
7. **Clients.** Members join from the **mobile app only**, because they have no web portal
   login today. Trainers can join from the **web portal** (`livekit-client` +
   `@livekit/components-react`) or from the app. The app adds `@livekit/react-native` and its
   WebRTC module through the Expo config plugin, so a **new dev build and new EAS builds are
   required**. It does not run in Expo Go (the app already uses a dev client). This also adds
   the microphone permission, iOS background audio, and an Android foreground-service
   notification while in a call.
8. **A "starts soon" alert links straight into the call.** When the call opens (10 minutes before
   the start), the jobs runner sends a new alert:
   - `LIVE_CLASS_STARTING` goes to the booked members and the trainer.
   - `LIVE_PT_STARTING` goes to the client and the trainer.

   Tapping the push alert, or the item in the inbox, opens the call screen. Lock-screen text stays
   generic ("Your online class is about to start. Tap to join."). The alerts follow the existing
   **Class reminders** and **Personal training** preferences. The existing 2-hour reminders are
   unchanged.
9. **Nothing is recorded or stored.** There is no Egress, no transcripts and no chat logs. The
   only data kept is the attendance in decision 5. Recording can be added later, together with
   consent capture and a storage target.

## Your LiveKit server: what it needs

- TLS on the signalling URL (`wss://`). Phones and browsers refuse plain `ws://`, except on
  localhost.
- **TURN/TLS on port 443** (LiveKit's embedded TURN, or coturn). Without it, many mobile and
  corporate networks cannot connect. Status of the current server, checked 2026-10-21:
  - Media between two browsers works over direct UDP.
  - With relay only, no connection could be made, so TURN isn't available yet.
- An API key and secret for this app, used only by this app, in `.env`. Never commit them.
- The webhook pointed at `{APP_URL}/api/livekit/webhook`, signed with the same API key
  (`webhook: { api_key: …, urls: [...] }` in the LiveKit config). LiveKit must be able to reach
  that address, so a `localhost` URL works only when LiveKit runs on the same machine.
- `npm run live:check` checks the settings, the key, creating and closing a room, and that the
  webhook URL rejects unsigned calls.
- The server may be shared with other apps: this app only ever closes rooms named `g_…__class_…`
  or `g_…__pt_…`.

## Parts

All three parts are built.

**What the mobile app has (part 3)**
- **Join buttons:**
  - A member sees one on an online or hybrid class they're booked in, and on their online PT
    sessions (Workouts tab).
  - A trainer sees "Host the online class" or "Join the online session" on their Schedule tab.
  - Before the call opens, the button reads "you can join from HH:MM".
- **Call screen:** `/live/{class|pt}/{id}`, full screen, starting with a ready step for the
  camera and microphone:
  - Members joining a class start with both off. In PT, and for trainers, both start on.
  - The call shows everyone's camera in a grid, with mute, camera on/off, flip camera and leave.
  - The server's reasons appear as written, for example "You're on the waitlist…".
- **Alerts:** a tapped "starts soon" push alert or inbox item opens the call screen.
- **Native setup (`app.config.ts`):** `@livekit/react-native-expo-plugin` (call audio routed like
  a phone call) and `@config-plugins/react-native-webrtc`.
  - The camera and microphone texts are the same in every plugin that sets them; otherwise
    `expo-camera`'s `microphonePermission: false` would remove the microphone text.
  - `SYSTEM_ALERT_WINDOW` is blocked, since calls don't draw over other apps.
- **New builds:** the app needs new development builds (`npx expo run:android` /
  `npx expo run:ios`) and new EAS builds. Expo Go can't run calls.
- **Compatibility:** older app builds keep working, because the new response fields are additions.

**What the web portal has (part 2)**
- **Booking:** "Where" appears when scheduling a class (in the room, online only, or hybrid)
  and when booking PT (in person or online).
- **Lists:** online and hybrid badges show on the timetable, the class page, PT sessions, a
  client's PT page and My schedule. My schedule now lists PT sessions too.
- **Join call:** the button shows only to the session's own trainer. It says "Call opens HH:MM"
  until 10 minutes before the start, then opens `/g/{gym}/live/{class|pt}/{id}`:
  - The call page has a video grid and controls (mic, camera, screen share, leave). It has no
    chat and no settings menu.
  - A class host also gets a list of people in the call, with mute and remove buttons. Removing
    disconnects someone, but they can rejoin while they're still booked. To keep them out,
    cancel their booking as well.
- **Attendance:** "joined online · 42 min" (or "online now") shows on the class roster and on
  the PT sessions list.
- **Security headers:** `Permissions-Policy` now allows the microphone and screen sharing on
  this site. The CSP `connect-src` allows the LiveKit host (`wss://` and `https://`), taken from
  `LIVEKIT_URL`.
- **Tests:** the e2e tests use a throwaway LiveKit address, so they check booking and the join
  gates but not media.

| Part | Contents |
|---|---|
| **1. Server foundation** | Env config, `featureLiveSessions` flag, `deliveryMode` on both session tables (migration, room nullable for online classes), `LiveAttendance` with RLS and `app_record_live_event()`, the member timetable including online classes, the token service (`src/server/services/live/join.ts`: join window, who may join, grants), the mobile endpoint `POST /api/mobile/v1/live/{class\|pt}/{sessionId}/token` (rate-limited, in the OpenAPI contract), closing rooms on cancel and in the jobs runner, the webhook, `live:check`, and unit and integration tests that decode the issued tokens to check their grants. |
| **2. Web portal** | The web join (server action), the CSP and Permissions-Policy changes, the "Where" choice when scheduling classes and booking PT, online badges and Join buttons in the lists, the call page with host controls, and "joined online" on the class roster and PT sessions. Integration and e2e tests. |
| **3. Mobile app** | The LiveKit React Native SDK and config plugins, the ready step and the call screen, Join buttons on the member's class and PT sessions and the trainer's schedule, `deliveryMode` in the mobile API, the `LIVE_*_STARTING` alerts with push and inbox links, and unit, integration and Jest tests. Requires new app builds. |

Each part stops for review before the next.
