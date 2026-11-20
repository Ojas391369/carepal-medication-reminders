# TheCarePal Medication: schedule, adherence and reminders (FS-05)

A shared medication schedule that the nurse updates and the family can see. Built for the TheCarePal Full Stack Developer Intern assignment FS-05.

**Stack:** React (Vite) front end, Node.js + Express back end, SQLite (Node's built-in `node:sqlite`), Web Push (VAPID) and optional email (SMTP).

All data is **synthetic**. The demo patients, medicines and history are invented. No real patient records are used.

## What it does

| Requirement | Where |
|---|---|
| Add medicines: name, dose, times, start/end date, before/after food | **Medicines** tab, `server/src/lib/validate.js` |
| Daily schedule: mark each dose given or skipped (reason required when skipped) | **Today** tab |
| Family view: weekly adherence %, skipped doses | **Overview / Family view** tab |
| Reminders at dose time (web push, plus email if SMTP is set) | `server/src/scheduler.js`, `server/src/notify.js`, `client/public/sw.js` |
| Stock tracking with a "runs out within N days" warning | `stockStatus()` in `server/src/lib/schedule.js` |
| Bonus: prescription photo per medicine | **Medicines** tab, "Attach prescription" |
| Bonus: day/night handover notes | **Handover** tab |

Medicines are exposed in the JSON shape requested, so they can connect to the prescription-reading AI task:

```json
{ "name": "Metformin", "strength": "500 mg", "dose": "1 tablet", "times": ["08:00", "20:00"],
  "food": "after", "startDate": "2026-09-01", "endDate": "" }
```

`GET /api/patients/:id/medicines` returns these fields (plus `id`, stock fields and a `supply` summary), and `POST /api/patients/:id/medicines` accepts exactly this shape. An empty `endDate` means the medicine is ongoing.

## Run it

Requires **Node.js 22.13 or newer** (the database is built into Node, so there is nothing native to compile).

```bash
npm install
cp server/.env.example server/.env     # optional, defaults work for a demo
npm run dev                            # API on :4000, app on http://localhost:5173
```

The first start creates `server/data/carepal.db` and loads demo data automatically. Reset it any time with `npm run seed`.

Sign in with the demo codes shown on the login screen (defaults: caregiver `nurse123`, family `family123`).

Production style (one port, serves the built app):

```bash
npm start        # builds the client, then serves everything on http://localhost:4000
```

Tests (scheduling, adherence, stock, validation, dose logging, reminder de-duplication):

```bash
npm test
```

### Trying reminders

1. Sign in, open **Today**, press **Turn on** in the reminders card and allow notifications.
2. Press **Send test** to confirm the device receives a push.
3. Add a medicine with a time two minutes from now. A push arrives at that minute. It is sent once per dose.
4. Optional email: set the `SMTP_*` values in `server/.env` and save an address under **Family view → Email reminders**. Without SMTP the server logs `[email not configured]` instead.

Web push needs `localhost` or HTTPS. On iPhone it only works after "Add to Home Screen" (iOS 16.4+).

VAPID keys are generated into `server/data/vapid.json` on first run (git-ignored), or set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` yourself. No secrets are committed; use `server/.env.example` as the template.

## How it works

```
client/                React app (mobile-first, installable PWA)
  public/sw.js         receives push events and shows notifications
  src/views/           Today, Overview (family), Medicines, Handover, Login
server/src/
  lib/schedule.js      pure logic: daily doses, adherence, stock (unit tested)
  lib/validate.js      input validation
  service.js           business logic on top of SQLite
  app.js               Express routes, role checks, error handling
  scheduler.js         every 30 s: find due doses, notify once
  notify.js            web push and email
```

Key design decisions:

- **Dates and times are plain strings in one time zone** (`APP_TZ`, default `Asia/Kolkata`). This avoids the off-by-one-day bugs from mixing UTC and local time, and it matches how a nurse thinks ("08:00 today").
- **Doses are derived, not stored.** A schedule is a medicine plus times; only the *outcome* (given or skipped) is saved in `dose_logs`. Editing a medicine never leaves stale pre-generated rows.
- **Adherence = given ÷ (given + skipped + missed).** A dose with no record counts as missed once it is 60 minutes overdue, so a dose that is 5 minutes late does not lower the score. Upcoming doses are not counted. Skipped doses are shown with their reason rather than hidden, so the family can tell "patient refused" from "forgotten".
- **Stock only drops when a dose is marked given,** and is restored on undo or if changed to skipped. The warning looks at the course end date: a 7-day antibiotic with 21 tablets left does not raise a false alarm.
- **Reminders are claimed in the database** (`reminders_sent` primary key) before sending, so a restart or an overlapping tick cannot send the same reminder twice. A 10-minute catch-up window covers a briefly busy server.
- **Roles are enforced on the server.** Family sessions can read everything but cannot record doses or edit medicines. Prescription photos are served only to signed-in users (not as public URLs).
- **Mobile first.** Large tap targets, bottom tab bar, one-handed dose marking.

## Assumptions

- Login is a simple access code per role with in-memory sessions. This is deliberate for a demo; see "next".
- Push subscriptions are per device, not per patient. Every subscribed device gets every reminder, and the patient name is in the title.
- Weekly adherence is the rolling last 7 days including today.
- Doses can be recorded for today and past days (to fix a missed entry) but not for future days.

## What I would build next

- Real authentication (Firebase Auth or similar) with per-patient access for each nurse and family member, and per-patient push subscriptions.
- Escalation: if a dose is still unrecorded 30 minutes after the reminder, alert the family or the operations team.
- Hook the JSON shape up to the prescription-reading AI task so a scanned prescription fills the medicine form for review.
- Refill reminders that message the family, and a PIN or biometric check before changing medicines.
- Offline support in the service worker so doses can be recorded without signal and synced later.
- Drug interaction and duplicate-dose checks, reviewed with a clinician before any real use.

## AI tools used

## AI tools used

I used **Claude (Anthropic)** as my main development partner on this assignment. It researched the approach (Web Push and VAPID keys, iOS push limits, `node:sqlite`), proposed the architecture and design decisions described above, and wrote the code, the tests and this README.

My part was running and testing the app on my own machine, checking each requirement against the assignment, and reporting problems back so they could be fixed. For example, I hit a push-registration error in my browser, a mismatch between the browser's saved subscription and the server after resetting the data folder, and repeated notifications that did not pop up. I also decided what to include and what to leave out for a first version.

I have read through the main files (`schedule.js`, `scheduler.js`, `service.js` and `app.js`) so I can explain how the schedule, adherence, stock and reminder logic work. The README's "What I would build next" section lists what is still a prototype.

> This is a demo for an assignment, not a medical device. Do not use it to manage real treatment.
