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
8. **Reminders link straight into the call.** The existing class and PT reminders get a "Join"
   deep link for online sessions, and a new alert ("Your online class starts in 10 minutes") is
   sent when the window opens. Lock-screen text stays generic, as for other alerts. These alerts
   use the existing **Classes** and **Personal training** preferences.
9. **Nothing is recorded or stored.** There is no Egress, no transcripts and no chat logs. The
   only data kept is the attendance in decision 5. Recording can be added later, together with
   consent capture and a storage target.

## Your LiveKit server: what it needs

- TLS on the signalling URL (`wss://`). Phones and browsers refuse plain `ws://`, except on
  localhost.
- **TURN/TLS on port 443** (LiveKit's embedded TURN, or coturn). Without it, many mobile and
  corporate networks cannot connect.
- An API key and secret for this app, used only by this app, in `.env`. Never commit them.
- The webhook pointed at `{APP_URL}/api/livekit/webhook`, signed with the same API key
  (`webhook: { api_key: …, urls: [...] }` in the LiveKit config). LiveKit must be able to reach
  that address, so a `localhost` URL works only when LiveKit runs on the same machine.
- `npm run live:check` checks the settings, the key, creating and closing a room, and that the
  webhook URL rejects unsigned calls.
- The server may be shared with other apps: this app only ever closes rooms named `g_…__class_…`
  or `g_…__pt_…`.

## Parts

Part 1 is built; part 2 is next.

| Part | Contents |
|---|---|
| **1. Server foundation** | Env config, `featureLiveSessions` flag, `deliveryMode` on both session tables (migration, room nullable for online classes), `LiveAttendance` with RLS and `app_record_live_event()`, the member timetable including online classes, the token service (`src/server/services/live/join.ts`: join window, who may join, grants), the mobile endpoint `POST /api/mobile/v1/live/{class\|pt}/{sessionId}/token` (rate-limited, in the OpenAPI contract), closing rooms on cancel and in the jobs runner, the webhook, `live:check`, and unit and integration tests that decode the issued tokens to check their grants. |
| **2. Web portal** | The web join (server action) and the CSP `connect-src` for the LiveKit URL, an "Online / Hybrid" choice when scheduling classes and booking PT, online badges in the schedule and lists, the staff live room page (video grid, host controls, leave), "joined online" on the class roster and PT session, and e2e tests (token issuance and the gates; media itself is not tested in CI). |
| **3. Mobile app** | The LiveKit React Native SDK and config plugins, a pre-join screen (camera/mic check), the call screen for members and trainers, Join buttons on My classes, My trainer and the trainer schedule, deep links from reminders, and the "starts in 10 minutes" alert. Requires a new dev build. |

Each part stops for review before the next.
