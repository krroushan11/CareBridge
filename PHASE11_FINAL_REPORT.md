# Phase 11 - Follow-up and Test Tracking

## 1. Objective

Phase 11 gives verified care-plan follow-ups and tests a persistent, owner-scoped home. Document-derived follow-ups and tests were previously JSON records inside a draft/verified care plan with no lifecycle, filters, or reminder surface. This phase adds dedicated `follow_ups` and `medical_tests` tables, controlled status lifecycles, owner-scoped CRUD endpoints, reminder feeds, and an integrated tracking dashboard, while leaving the Phase 9 care-plan records and Phase 10 medication scheduling untouched.

## 2. Initial Repository State

Before this phase, the repository contained draft and verified care plans whose `follow_up` and `tests` collections were stored as JSON. There was no follow-up or medical-test table, no status lifecycle beyond plan-level validation, no reminder feed for appointments or tests, and no dashboard surface for tracking them. The frontend dashboard covered medication schedules only.

## 3. Database Changes

Migration created: `backend/database/migrations/20260920_phase11_follow_ups_tests.sql`.

| Table | Purpose |
| --- | --- |
| `follow_ups` | Owner-scoped follow-up task with title, description, provider/specialist, appointment date and time, optional due date, status, completion/cancellation timestamps, document traceability, and a dedup fingerprint. |
| `medical_tests` | Owner-scoped medical test with test name, instructions, scheduled date, optional result summary, status, completion/cancellation timestamps, document traceability, and a dedup fingerprint. |

Both tables use UUID foreign keys to `users` and optional references to `medical_documents` and `verified_care_plans`. Constraints include:

- Status whitelists: five states for follow-ups, four for tests.
- Status/timestamp consistency: `completed` requires `completed_at`, `cancelled` requires `cancelled_at`.
- Per-owner partial unique index on `(user_id, record_fingerprint)` for duplicate protection.
- Owner/status/date and owner/created indexes for list and reminder queries.

The migration is additive and idempotent and does not alter or remove existing tables. `backend/database/schema.sql` carries the same definitions for fresh installs, and `docker-compose.yml` mounts the migration as `010_phase11_follow_ups_tests.sql`.

## 4. Tracking Workflow

```text
Extract document
  → owner verifies the care plan (Phase 8/9)
  → confirmation syncs follow-ups and tests into tracking records
  → user reviews, reschedules, completes, or cancels tasks
  → reminder feeds surface active tasks within the chosen window
  → status counts and overdue flags summarize the workload
```

Directly created records (not document-derived) start as `pending` unless the user selects another status.

## 5. API Endpoints

All endpoints require JWT authentication and use owner-scoped database queries.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/follow-ups` | List owned follow-ups with counts, overdue flags, and `status`/`from`/`to` filters. |
| `POST` | `/api/follow-ups` | Create a follow-up. |
| `GET` | `/api/follow-ups/:id` | Retrieve one owned follow-up. |
| `PATCH` | `/api/follow-ups/:id` | Update fields or status. |
| `POST` | `/api/follow-ups/:id/complete` | Mark completed (idempotent). |
| `DELETE` | `/api/follow-ups/:id` | Delete an owned follow-up. |
| `GET` | `/api/follow-ups/reminders/upcoming` | Active follow-ups within the reminder window. |
| `GET` | `/api/medical-tests` | List owned tests with counts, overdue flags, and filters. |
| `POST` | `/api/medical-tests` | Create a medical test. |
| `GET` | `/api/medical-tests/:id` | Retrieve one owned test. |
| `PATCH` | `/api/medical-tests/:id` | Update fields or status. |
| `POST` | `/api/medical-tests/:id/complete` | Mark completed with an optional result summary (idempotent). |
| `DELETE` | `/api/medical-tests/:id` | Delete an owned test. |
| `GET` | `/api/medical-tests/reminders/upcoming` | Active tests within the reminder window. |
| `GET` | `/api/reminders/upcoming` | Combined owner-scoped reminder feed ordered by date. |

## 6. Status Lifecycles and Timestamps

```text
follow-up:    pending → scheduled → completed | cancelled | missed
medical test: pending → scheduled → completed | cancelled
```

- The backend stamps `completed_at` when a record becomes `completed` and `cancelled_at` when it becomes `cancelled`, and clears the other terminal timestamp.
- Reopening a terminal record clears terminal timestamps so stored state stays internally consistent.
- Creation with an explicit terminal status also writes its timestamp, so the consistency constraint holds on insert as well as update.
- Completion uses a guarded update (`status NOT IN ('completed')`), so a repeat request returns the existing record with `already_completed: true` and never rewrites it.

## 7. Dates, Overdue Flags, and Missing Information

- `calendarDateSchema` accepts real `YYYY-MM-DD` dates; times accept `HH:MM` or `HH:MM:SS`.
- A follow-up's effective date is its appointment date, falling back to its due date; a test uses its scheduled date.
- `overdue` is derived at read time for active records whose effective date has passed. It is never stored.
- `normalizeAiDate` resolves ISO dates, ISO date-times, and explicit relative timeframes (`in 2 weeks`, `next week`, `tomorrow`). Unsupported free-form text such as `after surgery` yields no date rather than a guessed one.
- `mapExtractionTests` stores an extracted result verbatim; a test with a result is created `completed`, a test without one stays `pending`. Results are never invented.

## 8. Duplicate Protection and Care-Plan Sync

`syncVerifiedCarePlanTaskRecords` runs inside the existing confirmation transaction. Each mapped record carries a SHA-256 fingerprint over its canonicalized title/test name and source text. Inserts use `ON CONFLICT (user_id, record_fingerprint) WHERE record_fingerprint IS NOT NULL DO UPDATE SET updated_at = NOW()`, so:

- Re-confirming a document refreshes `updated_at` only.
- No duplicate task rows are created.
- Owner-made status, date, and result changes are never overwritten.

## 9. Frontend Dashboard

The health dashboard adds a care tracking overview with follow-up and test metrics, a next-14-days upcoming actions list, filtered follow-up and medical-test sections with creation forms, and per-record actions to complete, mark scheduled, reopen, cancel, or delete. Status badges distinguish pending, scheduled, completed, cancelled, missed, and overdue states.

`frontend/src/trackerUtils.js` holds the deterministic helpers: effective dates, overdue detection, reminder eligibility, reminder-window filtering with deduplication and sorting, date formatting, and dashboard metrics.

## 10. Security Controls

- JWT authentication protects every tracking route.
- All reads and writes filter by the authenticated user ID; another user's record returns a not-found response instead of data.
- Strict Zod schemas reject malformed dates, invalid times, unsupported statuses, oversized text, and unexpected fields before any query runs.
- SQL queries are parameterized and API errors are generic without credentials, tokens, database configuration, or internal details.
- Reminder feeds exclude `completed`, `cancelled`, and `missed` records.
- Phase 9 care-plan and Phase 10 medication logic was not changed.

## 11. Tests and Validation

Focused test file: `backend/test/followUpTracking.test.ts` (18 tests).

| Check | Result |
| --- | --- |
| TypeScript: `npx.cmd tsc --noEmit` | Passed |
| Focused Phase 11 tests: `node --import tsx --test --test-force-exit test/followUpTracking.test.ts` | Passed: 18/18 |
| Backend regression suite: `node --import tsx --test --test-force-exit test/*.test.ts` | Passed: 101/101 |
| Frontend tracking tests: `npm.cmd run test:trackers` | Passed: 7/7 |
| Frontend reminder tests: `npm.cmd run test:reminders` | Passed: 4/4 |
| Frontend: `npm.cmd run build` | Passed |

Focused tests cover unauthenticated rejection, owner-scoped creation with validated dates/times/statuses, cross-user read/update/delete/complete returning not-found, completion timestamp stamping and idempotent repeats, status-filter validation with derived counts, reminder queries excluding terminal records, AI mapping of absolute/relative/ambiguous dates, verbatim result preservation, and deterministic fingerprints. Frontend tests cover badge classes, effective-date precedence, overdue and reminder eligibility, window filtering with deduplication, safe date formatting, and dashboard metrics.

Two defects found while finishing this phase were fixed:

- SQL inserts that accepted a terminal status never wrote the matching timestamp, which violated the new consistency constraints. Direct creation, care-plan sync, and the medical-test completion path now write `completed_at`/`cancelled_at` correctly.
- `backend/src/config/database.ts` held a checked-out pool client for the process lifetime, so `pool.end()` never resolved and backend test suites only exited under `--test-force-exit`. The startup check now uses `pool.query("SELECT 1")`, which releases the client; the Phase 11 suite exits on its own in about 4 seconds.

## 12. Files Created or Modified

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
- `README.md`

## 13. Known Limitations

- Reminder feeds are pull-based APIs; the dashboard must be open for in-page checks.
- No push, email, SMS, service-worker, background, offline, or emergency delivery.
- Follow-ups are not auto-transitioned to `missed` on a timer; the derived `overdue` flag and explicit status changes express the same state.
- No per-user time-zone configuration; dates are calendar dates without a stored zone.
- Tracking records remain owner-only; caregivers and clinicians have no access until the care-relationship model is introduced.

## 14. Final Checklist

- [x] Owner-scoped follow-up records with structured dates and times
- [x] Owner-scoped medical-test records with scheduled date and result summary
- [x] Controlled status lifecycles with timestamp consistency
- [x] Complete, cancel, reopen, update, and delete actions
- [x] Status/date filters, counts, and derived overdue flags
- [x] Upcoming reminder feeds (follow-ups, tests, combined)
- [x] Verified-care-plan sync with duplicate protection
- [x] AI dates normalized when deterministic, never invented
- [x] Tracking dashboard with metrics, filters, and task actions
- [x] Backend and frontend tests, TypeScript check, and frontend build all passing
