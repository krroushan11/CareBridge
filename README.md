# CareBridge AI - Phase 11: Follow-up and Test Tracking

## Phase 11 Overview

Phase 11 turns document-derived follow-ups and medical tests into owner-scoped, trackable tasks. Records come from either verified care plans or direct user entry, keep their document traceability, and move through controlled status lifecycles with filtered lists, reminder feeds, and a tracking dashboard. Phase 9 verified-care-plan records and Phase 10 medication scheduling remain unchanged.

## Objectives

- Persist owner-scoped follow-up appointments and tasks with structured dates and times.
- Persist owner-scoped medical tests with scheduled dates, instructions, and result summaries.
- Enforce controlled status lifecycles instead of free-form status strings.
- Provide filters, per-status counts, and derived overdue flags.
- Provide upcoming reminder feeds for follow-ups, tests, and both combined.
- Sync verified care-plan follow-ups and tests into tracking records without duplicating on re-confirmation.

## Tracking Database and Workflow

The Phase 11 migration adds two UUID-based, owner-scoped tables:

| Table | Purpose |
| --- | --- |
| `follow_ups` | Stores the task title, description, provider/specialist, appointment date and time, optional due date, status, and completion/cancellation timestamps. |
| `medical_tests` | Stores the test name, instructions, scheduled date, optional result summary, status, and completion/cancellation timestamps. |

Both tables keep optional `document_id` and `verified_care_plan_id` references so a tracked task stays traceable to the document it came from, plus a per-owner `record_fingerprint` used for duplicate protection.

```text
Extract document
  → owner verifies the care plan
  → confirm syncs follow-ups and tests into tracking records
  → user reviews, reschedules, completes, or cancels tasks
  → reminder feeds surface active tasks within the chosen window
```

The migration is additive and idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`) and does not alter or remove Phase 9 or Phase 10 data.

## Status Lifecycles

```text
follow-up:    pending → scheduled → completed | cancelled | missed
medical test: pending → scheduled → completed | cancelled
```

- `completed` requires `completed_at` and `cancelled` requires `cancelled_at`; the backend stamps them on the completing request and clears the other terminal timestamp.
- Reopening a terminal record (for example back to `pending` or `scheduled`) clears terminal timestamps so the stored state stays consistent.
- Completing an already-completed follow-up or test is idempotent: the guarded update matches no row and the existing record is returned with `already_completed: true`.
- A status/timestamp consistency check in the database rejects any write that marks a record complete or cancelled without its timestamp.

## Dates, Overdue Flags, and Missing Information

- Dates are validated as real calendar dates in `YYYY-MM-DD` form and times as `HH:MM` or `HH:MM:SS`.
- A follow-up's effective date is its appointment date, falling back to its due date; a medical test uses its scheduled date.
- `overdue` is derived at read time and is never stored: an active (non-terminal) record whose effective date has passed is flagged overdue.
- Relative and free-form AI dates (`in 2 weeks`, `next month`) are resolved when deterministic. Unsupported text such as `after surgery` produces no date at all, so undated tasks stay undated instead of receiving an invented one.
- Extracted test results are stored verbatim when the document states them; the backend never invents a result value.

## API Endpoints

All tracking endpoints require JWT authentication and use owner-scoped queries.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/follow-ups` | List owned follow-ups with counts, overdue flags, and optional `status`/`from`/`to` filters. |
| `POST` | `/api/follow-ups` | Create a follow-up. |
| `GET` | `/api/follow-ups/:id` | Retrieve one owned follow-up. |
| `PATCH` | `/api/follow-ups/:id` | Update follow-up fields or status. |
| `POST` | `/api/follow-ups/:id/complete` | Mark an owned follow-up completed. |
| `DELETE` | `/api/follow-ups/:id` | Delete an owned follow-up. |
| `GET` | `/api/follow-ups/reminders/upcoming` | Active follow-ups within the reminder window. |
| `GET` | `/api/medical-tests` | List owned tests with counts, overdue flags, and optional filters. |
| `POST` | `/api/medical-tests` | Create a medical test. |
| `GET` | `/api/medical-tests/:id` | Retrieve one owned test. |
| `PATCH` | `/api/medical-tests/:id` | Update test fields or status. |
| `POST` | `/api/medical-tests/:id/complete` | Mark an owned test completed, with an optional result summary. |
| `DELETE` | `/api/medical-tests/:id` | Delete an owned test. |
| `GET` | `/api/medical-tests/reminders/upcoming` | Active tests within the reminder window. |
| `GET` | `/api/reminders/upcoming` | Combined owner-scoped reminder feed ordered by date. |

## Duplicate Protection and Care-Plan Sync

Confirming a document runs the existing tracker sync and adds a task sync in the same transaction. Each mapped record carries a deterministic fingerprint derived from its title or test name and source text. A partial unique index on `(user_id, record_fingerprint)` lets the sync insert with `ON CONFLICT DO UPDATE SET updated_at`, so re-confirming a document refreshes timestamps only. It never creates duplicates and never overwrites an owner's manual status, date, or result changes.

## Tracking Dashboard

The frontend health dashboard (authenticated non-doctor users with no document selected) adds:

- A care tracking overview with follow-up and medical-test status metrics.
- An upcoming actions list for the next 14 days, including overdue active tasks.
- Follow-up and medical-test sections with status/date filters and creation forms.
- Task actions for marking complete or scheduled, reopening, cancelling, and deleting.
- Status badges that distinguish pending, scheduled, completed, cancelled, missed, and overdue records.

`frontend/src/trackerUtils.js` holds the deterministic helpers for effective dates, overdue and reminder eligibility, reminder-ready filtering and sorting, date formatting, and dashboard metrics.

## Database Migration

```text
backend/database/migrations/20260920_phase11_follow_ups_tests.sql
```

The migration creates `follow_ups` and `medical_tests`, indexes them by owner/status/date, and adds foreign-key, status-lifecycle, timestamp-consistency, and per-owner fingerprint constraints. Docker Compose mounts it as `010_phase11_follow_ups_tests.sql` for fresh database initialization.

## Backend Implementation

- `backend/src/services/trackerService.ts` defines the status sets, strict Zod schemas, date normalization, reminder helpers, fingerprints, and AI extraction mapping.
- `backend/src/controllers/followUpController.ts`, `backend/src/controllers/medicalTestController.ts`, and `backend/src/controllers/reminderController.ts` implement the owner-scoped tracking and reminder endpoints.
- `backend/src/routes/followUpRoutes.ts`, `backend/src/routes/medicalTestRoutes.ts`, and `backend/src/routes/reminderRoutes.ts` define the authenticated routes.
- `backend/src/controllers/analysisController.ts` syncs verified care-plan follow-ups and tests during confirmation.
- `backend/src/server.ts` mounts the route groups.

## Frontend Implementation

- `frontend/src/main.js` renders the tracking sections, filters, creation forms, and task actions.
- `frontend/src/trackerUtils.js` contains the pure tracking helpers.
- `frontend/index.html` includes the badge, chip, metric, and filter styles.

## Authentication and Security

- JWT authentication protects every tracking route.
- Every read and write is filtered by the authenticated user ID; requesting another user's record returns a not-found response instead of its data.
- Strict Zod schemas reject malformed dates, times, statuses, oversized text, and unexpected fields before any query runs.
- SQL queries are parameterized, and API errors are generic without credentials, tokens, database configuration, or internal details.
- Reminder feeds exclude completed, cancelled, and missed records.
- Phase 9 care-plan and Phase 10 medication logic remains unchanged.

## Tests and Validation

Focused backend tests: `backend/test/followUpTracking.test.ts`.

Focused frontend tracking tests: `frontend/test/trackerUtils.test.js`.

The current Phase 11 coverage includes:

- Unauthenticated listing rejection and owner-scoped access for follow-ups and tests.
- Cross-user read, update, complete, and delete attempts returning not-found responses.
- Creation validating dates, times, names, and status values before persistence.
- Completion stamping `completed_at`, preserving prior fields, and idempotent repeats.
- Status-filter validation, overdue derivation, and per-status counts.
- Reminder queries excluding completed and cancelled records.
- AI mapping of supported, relative, and ambiguous dates plus result preservation.
- Deterministic fingerprints for duplicate protection across repeated extractions.
- Frontend badge, effective-date, overdue, eligibility, reminder-window, formatting, and metrics helpers.

Validation commands:

```text
npx.cmd tsc --noEmit
node --import tsx --test --test-force-exit test/followUpTracking.test.ts
node --import tsx --test --test-force-exit test/medicationManagement.test.ts
npm.cmd run test:trackers
npm.cmd run test:reminders
npm.cmd run build
```

## Files Created or Modified for Phase 11

Created:

- `backend/database/migrations/20260920_phase11_follow_ups_tests.sql`
- `backend/src/controllers/followUpController.ts`
- `backend/src/controllers/medicalTestController.ts`
- `backend/src/controllers/reminderController.ts`
- `backend/src/routes/followUpRoutes.ts`
- `backend/src/routes/medicalTestRoutes.ts`
- `backend/src/routes/reminderRoutes.ts`
- `backend/src/services/trackerService.ts`
- `backend/test/followUpTracking.test.ts`
- `frontend/src/trackerUtils.js`
- `frontend/test/trackerUtils.test.js`
- `PHASE11_FINAL_REPORT.md`

Modified:

- `backend/database/schema.sql`
- `backend/src/controllers/analysisController.ts`
- `backend/src/config/database.ts`
- `backend/src/server.ts`
- `docker-compose.yml`
- `frontend/index.html`
- `frontend/src/main.js`
- `frontend/package.json`
- `docs/api.md`
- `docs/development-roadmap.md`

## Known Limitations

- Reminder feeds are pull-based APIs; the dashboard must be open for in-page checks to run.
- There is no push, email, SMS, service-worker, background, offline, or emergency reminder delivery.
- Missed follow-ups are not auto-transitioned on a timer yet; the derived `overdue` flag and explicit status changes express the same state.
- Per-user time-zone settings are not implemented, so dates are interpreted as calendar dates without a stored zone.
- Tracking records are owner-only; caregivers and clinicians still have no access until the care-relationship model is introduced.
