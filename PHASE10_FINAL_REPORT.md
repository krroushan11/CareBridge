# Phase 10 - Medication Management

## 1. Objective

Phase 10 adds owner-scoped medication scheduling, dose tracking, adherence analytics, and an integrated medication dashboard to CareBridge AI. It keeps the Phase 9 verified-care-plan tracker records unchanged: those records remain document-derived source data, while Phase 10 medications are user-managed schedules with their own dose history.

## 2. Initial Repository State

Before this phase, the repository contained Phase 9 `medication_tracker_records`, which stored medications derived from a verified care plan. It did not contain a medication schedule table, per-dose status history, medication routes, adherence calculations, dashboard, or reminder infrastructure. The frontend was a single Vite page for document review and clinician review.

## 3. Database Changes

Migration created: `backend/database/migrations/20260919_phase10_medication_management.sql`.

| Table | Purpose |
| --- | --- |
| `medications` | Owner-scoped daily medication schedule, dose times, active state, start/end dates, instructions/notes, and grace period. |
| `medication_doses` | One status record for each scheduled medication dose, including `scheduled`, `taken`, `skipped`, or `missed` state and associated timestamps. |

Both tables use UUID foreign keys to `users`; `medication_doses` also references its medication. The migration is additive and idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`); it does not alter or remove Phase 9 data.

## 4. Medication Workflow

```text
Create daily medication schedule
  → generate unique scheduled-dose history rows
  → display due/upcoming doses
  → record taken or skipped action
  → mark still-scheduled doses missed after their grace period
  → calculate adherence from stored dose history
```

The current schedule type is intentionally limited to `daily`. Each medication accepts one or more unique `HH:MM` dose times. Active schedules are materialized through the current date plus 30 days. The unique `(medication_id, scheduled_at)` constraint prevents duplicate scheduled-dose rows.

## 5. API Endpoints

All endpoints require JWT authentication and use owner-scoped database queries.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/medications` | Return the authenticated user’s medications, today's doses, due/upcoming doses, recent missed doses, and adherence analytics. |
| `POST` | `/api/medications` | Create a daily medication schedule. |
| `POST` | `/api/medications/:id/taken` | Mark an owner’s due scheduled dose as taken. |
| `POST` | `/api/medications/:id/skipped` | Mark an owner’s due scheduled dose as skipped. |

The `taken` and `skipped` actions accept an optional `scheduled_at` timestamp to target a particular dose. Repeating a `taken` request for a dose already marked taken returns the existing record without creating another dose-history row.

## 6. Taken, Skipped, and Missed Logic

- New dose rows start as `scheduled`.
- A due owner-scoped `scheduled` dose can become `taken`; the backend records `taken_at` using the database current timestamp.
- A due owner-scoped `scheduled` dose can become `skipped`; the backend records `skipped_at`.
- A `scheduled` dose becomes `missed` only when `scheduled_at + grace_period_minutes` is at or before the database current time. The default grace period is 240 minutes and can be set from 0 to 1440 minutes at schedule creation.
- A dose already in a terminal state (`taken`, `skipped`, or `missed`) cannot be overwritten by a different action.

## 7. Adherence and Analytics

Adherence uses real stored `medication_doses` records:

```text
adherence percentage = taken eligible doses / all eligible scheduled doses × 100
```

Eligible means a dose scheduled at or before the current time. Future doses are excluded. If there are no eligible doses, the API returns `null` rather than fabricating a percentage.

The list response includes overall and medication-specific eligible, taken, skipped, and missed counts; adherence percentage; recent missed doses; due doses still inside their grace period; and upcoming scheduled doses.

## 8. Dashboard and Reminders

The existing frontend now shows the medication dashboard for authenticated non-doctor users when no document is selected. It supports creating a medication, displaying schedules and adherence, marking today’s doses taken or skipped, and showing upcoming/recent missed doses.

Browser notifications are opt-in and request permission only from the explicit **Enable browser notifications** action. Reminder sound is separately opt-in: **Enable Reminder Sound** and **Test Reminder Sound** are user interactions that unlock the Web Audio context before a short local synthesized ringtone can play. A due dose can be snoozed for 10 minutes in the current page session or marked taken through the existing owner-scoped API.

Notification and sound delivery are deduplicated independently by dose ID, so a dose produces at most one notification and one sound in a page session. Snoozing suppresses both until its client-side snooze interval ends; it does not change the stored scheduled-dose status. Reminders are muted on request for the current page session.

No push service, service worker, background, offline, or device-level reminder is implemented. The dashboard must be open for checks to occur, and browser/device permissions and lifecycle restrictions may prevent notification or sound delivery.

## 9. Security Controls

- JWT authentication protects every medication route.
- Medication and dose reads/actions filter by the authenticated user ID.
- A request for another user’s medication receives a not-found response rather than accessing its data.
- Strict Zod validation bounds medication text, dates, time format, dose-time count, grace period, and unexpected fields.
- SQL queries are parameterized.
- API errors are generic and do not expose database configuration, credentials, tokens, or internal error details.
- Phase 9 care-plan, tracker, and ownership logic was not changed.

## 10. Tests and Validation

Focused test file: `backend/test/medicationManagement.test.ts`.

| Check | Result |
| --- | --- |
| TypeScript: `npx.cmd tsc --noEmit` | Passed |
| Focused Phase 10 test command | Passed: 8/8 tests |
| Frontend reminder tests: `npm.cmd run test:reminders` | Passed: 4/4 tests |
| Frontend: `npm.cmd run build` | Passed |

Focused tests cover unauthenticated rejection, medication creation and time persistence, owner-only listing, real-history adherence with future-dose exclusion, taken tracking, idempotent duplicate taken handling, cross-user action rejection, skipped tracking, and grace-period missed reconciliation. Frontend tests cover due-dose detection, snooze exclusion, duplicate-reminder prevention, sound preference/unlocked-audio gating, and notification-permission gating.

## 11. Files Created or Modified

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
- `docs/api.md`
- `docs/development-roadmap.md`

## 12. Known Limitations

- Only daily schedules are supported in this phase.
- Dose times are stored as server-local timestamp values; the application does not yet provide per-user time-zone settings.
- Browser reminders require an open dashboard page. Notification and sound delivery depend on user interaction, browser support, and permission/autoplay policies; they are not reliable background/offline or emergency alert mechanisms.
- The sound is a synthesized Web Audio tone, not a device ringtone or background alarm.

## 13. Final Checklist

- [x] Medication database table/workflow
- [x] Daily medicine schedule and dose times
- [x] Taken tracking
- [x] Skipped tracking
- [x] Grace-period-based missed-dose history
- [x] Stored-history adherence calculation
- [x] Medication-specific and overall analytics
- [x] Integrated medication dashboard
- [x] Opt-in, in-page browser notifications and interaction-unlocked reminder sound with documented limitations
- [x] Required `GET /api/medications`
- [x] Required `POST /api/medications/:id/taken`
