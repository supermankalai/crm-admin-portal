# Personal Training (PT) module

A separate module for personal training: who trains whom, toward what goal, the sessions they
book, what the client paid for, and the results. Web pages live under `/g/{gym}/pt`, server code
under `src/server/services/pt/`, shared rules in `packages/shared/src/domain/pt.ts`.

It builds on what already exists (TrainerClient, TrainingSession, workout plans, progress
entries and photos, the inbox and push job) rather than replacing it.

## Decisions

1. **An assignment is a record with history, not a link.** `TrainerClient` gains a goal, targets,
   start date and who assigned it. Ending an assignment moves it to `PtAssignmentHistory`
   (append-only), so the trainer loses access at once (`app_is_trainer_of` reads only open
   assignments) while the record of who coached whom is kept. Future sessions between the two are
   cancelled. A member can have more than one trainer (for example strength and nutrition), but
   only one open assignment per trainer.
2. **Only owners and managers assign or end** (new permission `pt.manage`). The database enforces
   it too: TrainerClient writes need `app_is_manager_of_current_gym()`. Trainers see and coach
   their own clients; managers see everyone's.
3. **Goals are a category plus encrypted targets.** The category (weight loss, muscle gain,
   strength, endurance, general fitness, rehab, sport) is plain so it can be filtered and
   reported. Target weight and body fat, target date and the goal note are health data, so
   they're encrypted like measurements.
4. **Both people are told.** Assigning notifies the member (if they use the app) and the trainer.
   So do ending an assignment, a session booked by someone else, and a cancelled session. Each
   alert goes into the inbox and is pushed. Lock-screen text stays generic ("You have a new
   personal trainer"), with names inside the app only. A new preference, **Personal training**,
   turns these push alerts off.
5. **Results are visible on the web.** The client page shows the goal and progress toward it,
   the weight and body-fat chart, measurement changes, workout completion and the session
   history. Progress photos stay private to the member and their assigned trainers, as before:
   owners and managers see a count, not the photos.
6. **No new plan flag.** PT is part of every plan, as trainers already are. The member side needs
   the member app, which is already gated by its own plan flag.
7. **Session credits (part 2).** A gym sells PT packages ("10 sessions, 90 days"), optionally
   for one trainer only. The sale is an invoice (and optional payment) through the existing
   billing, so payments, receipts and revenue reports just work; voiding the invoice, or refunding
   it with "cancel what it paid for", cancels the package.
   - Booking a session takes a credit from the package that covers that day and ends soonest.
     Done and no-show sessions keep the credit; cancelled ones give it back. Credits are counted
     from the sessions, never stored, so they can't drift.
   - The database guards it too: a trigger locks the package and refuses a session that would
     overspend it, use someone else's, or fall outside its dates.
   - **Credits required** is an owner switch (Packages tab), off by default so existing gyms keep
     working. Off: a session uses a credit if there is one and is booked "not covered" if not.
     On: no credit, no booking — except owners and managers, who can book it complimentary.
   - Reminders go to member and trainer 2 hours before a session. Members (and their trainers)
     are told when a package is down to 1 and 0 sessions, and members when sessions will expire
     within 7 days.
   - Reports → **Trainers** shows clients, sessions done, no-shows and package sales per trainer
     for any period, with CSV export. Package names also appear in the revenue export.
8. **Firebase (part 3).** Each push token records how it is delivered. Android builds with
   `google-services.json` register their native FCM token, and the server sends to those directly
   through FCM HTTP v1 (`firebase-admin`, service account read from a file path in the
   environment and never committed). iOS keeps Expo to APNs until React Native Firebase is
   added. Expo tokens keep working, so nothing breaks while devices move over. The job, the
   preferences, the generic text and the receipts stay the same.

## Parts

Parts 1 and 2 are built; part 3 is next.

| Part | Contents |
|---|---|
| **1. Assignments, results, sessions (web)** | Assignment history and goals, `pt.manage` and RLS, notifications and their preference, the PT overview, the client list with an assign dialog, the client results page, and PT sessions on the web (book, complete, no-show, cancel). Seed data and tests. |
| **2. Packages and reminders** | The package catalog, selling packages through invoices, credits on sessions, session reminders to both people, low-credit and expiring-package alerts, and a trainer performance report with CSV export. |
| **3. Mobile and Firebase** | Member side: **My trainer** (trainer, goal and progress toward it, credits left, upcoming sessions) and alert deep links. Trainer side: goal on the client screen and credits when booking. The FCM provider and Android token registration. |

## Who can do what

| | Owner, manager | Trainer | Front desk | Member |
|---|---|---|---|---|
| See the PT overview | Whole gym | Own clients | No | No |
| Assign or end, set goals | Yes | No | No | No |
| See a client's results | Any client | Own clients | No | Own (app) |
| See progress photos | No | Own clients | No | Own |
| Book or close a PT session | Any trainer | Own clients | No | No |
| Manage the package catalog | Yes | See it | See it | No |
| Sell a package | Yes | No | Yes | No |
| Book complimentary sessions | Yes | No | No | No |
| Turn "credits required" on or off | Owner only | No | No | No |
| See a member's packages and credits | Yes | Own clients | Yes | Own (app, part 3) |
| Trainer report and CSV | Yes | No | No | No |
