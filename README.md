# CareBridge AI - Phase 10: Medication Management

## Phase 10 Overview

Phase 10 adds owner-scoped medication scheduling, dose-status history, adherence analytics, and a medication dashboard to CareBridge AI. It preserves Phase 9 verified-care-plan tracker records: those records remain document-derived information, while Phase 10 medications are user-managed schedules with separate dose history.

## Objectives

- Create owner-scoped daily medication schedules.
- Record scheduled, taken, skipped, and missed dose history.
- Calculate adherence from stored dose records without penalizing future doses.
- Provide medication-specific and overall analytics.
- Provide a dashboard with dose actions and in-page reminders.

## Medication Database and Workflow

The Phase 10 migration adds two UUID-based, owner-scoped tables:

| Table | Purpose |
| --- | --- |
| `medications` | Stores medication identity, dosage and unit, daily schedule, dose times, dates, active state, instructions/notes, and grace period. |
| `medication_doses` | Stores each scheduled dose and its `scheduled`, `taken`, `skipped`, or `missed` status with corresponding timestamps. |

```text
Create daily medication schedule
  → materialize scheduled dose records
  → show due and upcoming doses
  → record taken or skipped status
  → mark overdue scheduled doses as missed after their grace period
  → calculate adherence from stored history
```

The unique `(medication_id, scheduled_at)` constraint prevents duplicate scheduled-dose records. The migration is additive and idempotent.

## Medicine Schedule and Dose Time

Current schedules are limited to `daily`. A medication requires a name and one to eight unique dose times in `HH:MM` format. Schedules can also store dosage, dosage unit, start/end dates, instructions, notes, active state, and a grace period. Active schedules are materialized through the current date plus 30 days.

## Taken, Skipped, and Missed Dose Tracking

- A new dose begins as `scheduled`.
- `POST /api/medications/:id/taken` marks an owner’s due scheduled dose as `taken` and stores `taken_at`.
- `POST /api/medications/:id/skipped` marks an owner’s due scheduled dose as `skipped` and stores `skipped_at`.
- A still-scheduled dose becomes `missed` only after `scheduled_at + grace_period_minutes` has passed. The default grace period is 240 minutes; creation accepts 0–1440 minutes.
- Terminal states (`taken`, `skipped`, and `missed`) cannot be overwritten by a different action.
- Repeating a taken request for an already taken dose safely returns the existing record without creating another dose-history row.

## Adherence Calculation and Analytics

Adherence is calculated from real stored dose history:

```text
taken eligible doses / all eligible scheduled doses × 100
```

Eligible doses are scheduled at or before the current time. Future doses are excluded. When there are no eligible doses, the API returns `null` instead of fabricating a percentage.

`GET /api/medications` returns medication-specific and overall eligible, taken, skipped, and missed counts; adherence percentage; today’s doses; due doses within the grace period; upcoming doses; and recent missed doses.

## Medication Dashboard

The existing frontend displays the medication dashboard for authenticated non-doctor users when no document is selected. It supports:

- Creating daily medication schedules.
- Viewing medication schedules, adherence, today’s dose status, upcoming doses, and recent missed doses.
- Marking today’s scheduled doses as taken or skipped.
- Viewing due-dose reminder cards with **Mark as Taken** and **Snooze 10 minutes** actions.

## Medication Reminders

Reminders run only while the medication dashboard is open.

- Browser notification permission is requested only from the explicit **Enable browser notifications** action.
- Reminder sound is separately opt-in. **Enable Reminder Sound** and **Test Reminder Sound** are user interactions that unlock the Web Audio context before a synthesized tone can play.
- Notification and sound delivery are deduplicated independently by dose ID, so a dose produces at most one notification and one sound in a page session.
- Snooze suppresses the reminder for 10 minutes in the current page session and does not alter the stored dose status.
- Users can mute reminders for the current page session.

There is no push service, service worker, background, offline, device-level, or emergency notification support. Notification and sound delivery depend on an open dashboard, browser support, user permission, and autoplay policies.

## API Endpoints

All medication endpoints require JWT authentication and use owner-scoped queries.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/medications` | Return the authenticated user’s medication schedules, dose information, and analytics. |
| `POST` | `/api/medications` | Create a daily medication schedule. |
| `POST` | `/api/medications/:id/taken` | Mark an owner’s due scheduled dose as taken. |
| `POST` | `/api/medications/:id/skipped` | Mark an owner’s due scheduled dose as skipped. |

The taken and skipped endpoints accept an optional `scheduled_at` timestamp to identify a specific dose.

## Database Migration

```text
backend/database/migrations/20260919_phase10_medication_management.sql
```

The migration creates `medications` and `medication_doses`, indexes medication and dose history by owner and schedule, and adds foreign-key, status, timestamp, date-range, grace-period, and duplicate-dose constraints.

## Backend Implementation

- `backend/src/controllers/medicationController.ts` validates medication input with Zod, materializes schedules, reconciles missed doses, calculates analytics, and performs owner-scoped taken/skipped actions.
- `backend/src/routes/medicationRoutes.ts` defines authenticated medication routes.
- `backend/src/server.ts` mounts the route group at `/api/medications`.

## Frontend Implementation

- `frontend/src/main.js` renders the medication dashboard, calls the medication APIs, provides due-dose actions, and coordinates browser notifications and Web Audio reminders.
- `frontend/src/reminderUtils.js` contains deterministic helper logic for due-dose detection, snoozing, delivery deduplication, notification permission gating, and sound preference.

## Authentication and Security

- JWT authentication protects all medication routes.
- Medication and dose reads/actions are filtered by the authenticated user ID.
- A cross-user medication action receives a not-found response rather than accessing another user’s data.
- Strict Zod validation bounds names, optional text, dates, dose-time format/count, grace period, and unexpected fields.
- SQL queries are parameterized, and API errors do not expose credentials, tokens, database configuration, or internal details.
- Phase 9 care-plan, tracker, and ownership logic remains unchanged.

## Tests and Validation

Focused backend tests: `backend/test/medicationManagement.test.ts`.

Focused frontend reminder tests: `frontend/test/reminderUtils.test.js`.

The current Phase 10 coverage includes:

- Unauthenticated listing rejection.
- Schedule creation and dose-time persistence.
- Owner-only medication retrieval and analytics.
- Taken tracking, idempotent repeated taken handling, and cross-user rejection.
- Skipped tracking and grace-period missed-dose reconciliation.
- Due-dose detection, snooze exclusion, duplicate reminder prevention, sound preference/unlocked-audio gating, and notification-permission gating.

Validation commands:

```text
npx.cmd tsc --noEmit
node --import tsx --test --test-force-exit test/medicationManagement.test.ts
node --import tsx --test --test-force-exit test/analysisVerification.test.ts
npm.cmd run test:reminders
npm.cmd run build
```

## Files Created or Modified for Phase 10

Created:

- `backend/database/migrations/20260919_phase10_medication_management.sql`
- `backend/src/controllers/medicationController.ts`
- `backend/src/routes/medicationRoutes.ts`
- `backend/test/medicationManagement.test.ts`
- `frontend/src/reminderUtils.js`
- `frontend/test/reminderUtils.test.js`
- `PHASE10_FINAL_REPORT.md`

Modified:

- `backend/database/schema.sql`
- `backend/src/server.ts`
- `frontend/src/main.js`
- `frontend/package.json`
- `docs/api.md`
- `docs/development-roadmap.md`

## Known Limitations

- Only daily schedules are supported.
- Dose times use the application’s current server-local timestamp conventions; per-user time-zone configuration is not implemented.
- Reminders require the browser dashboard to remain open. They are not background, offline, or emergency alerts.
- Reminder sound is a synthesized Web Audio tone, not a device ringtone or background alarm.
