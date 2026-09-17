# CareBridge AI API

Base URLs:

- Local backend: `http://localhost:5000`
- Docker Compose backend: `http://localhost:5000`

Protected endpoints use:

```http
Authorization: Bearer <jwt>
```

## Health

`GET /`

Returns the backend/database connectivity response.

## Authentication

### Register

`POST /api/auth/register`

```json
{
  "name": "Patient Name",
  "email": "patient@example.com",
  "password": "strong-password"
}
```

Normal registration creates a patient account. The response contains safe user fields only.

### Login

`POST /api/auth/login`

```json
{
  "email": "patient@example.com",
  "password": "strong-password"
}
```

Returns a JWT and safe user fields.

### Profile

- `GET /api/auth/profile` — authenticated user's profile.
- `PUT /api/auth/profile` — update the authenticated user's name or email.
- `PUT /api/auth/change-password` — change the authenticated user's password. Requires
  `currentPassword`, `newPassword`, and matching `confirmPassword`.

### Password reset

- `POST /api/auth/forgot-password` — request an email OTP.
- `POST /api/auth/verify-reset-otp` — verify the OTP and receive a short-lived reset token.
- `POST /api/auth/reset-password` — reset the password with the reset token.
  Requires matching `newPassword` and `confirmPassword`.

### Admin role management

`PUT /api/auth/admin/users/:id/role`

Requires an authenticated admin JWT.

```json
{
  "role": "patient"
}
```

Allowed roles are `patient`, `caregiver`, `doctor`, and `admin`.

Only an admin may use this endpoint. Normal registration always creates a
`patient` account; clients cannot self-assign a privileged role. Document and
analysis endpoints remain owner-scoped for every role until a separate,
explicit care-relationship model is introduced.

## Medical documents

All endpoints require authentication.

- `POST /api/documents/upload` — multipart upload with field `document`; accepts PDF, JPEG, or PNG up to 10 MB.
- `GET /api/documents` — list the authenticated user's documents and safe processing metadata.
- `GET /api/documents/:id/extract` — generate structured information after processing completes.

- `GET /api/documents/:id/download` — download an owner-scoped private document with its stored MIME type.
- `PATCH /api/documents/:id` — rename an owner-scoped document with `{ "original_filename": "record.pdf" }`.
- `DELETE /api/documents/:id` — delete an owner-scoped document and its private local file.
- `GET /api/documents/:id/status` — retrieve owner-scoped processing status, timestamps, safe failure state, and retry metadata.

Uploads return after the database record is created with `uploaded` status. A PostgreSQL-backed background worker atomically claims queued records outside the HTTP request, processes them asynchronously, and records `processing`, `completed`, or `failed`. Transient processing failures are retried up to three total attempts with bounded exponential backoff. Stale processing records are recovered by the worker. The worker runs in the backend process; multi-instance production deployments should run one worker process per deployment or use shared queue-worker orchestration.

PDFs use native text extraction first and fall back to OCR when extracted text is below the readability threshold. JPEG and PNG files use OCR directly. Tesseract languages are configurable with the `OCR_LANGUAGES` environment setting using comma-separated language codes such as `eng,spa`; English remains the default and is used as a safe fallback when configured language data is unavailable.

After a completed document is successfully extracted, `GET /api/documents/:id/extract`
also creates or updates one owner-scoped DRAFT care plan for that document.
Medication records support name, dosage, frequency, route, duration,
instructions, and source text when explicitly returned by the provider.
Follow-up records support type/reason, date or timeframe, instructions,
provider/specialist, and source text when explicitly returned. Missing fields
remain unavailable; the service does not infer medical information. Repeating
the extraction is idempotent for the document's draft care plan. Failed,
malformed, incomplete, or non-owner extraction requests do not create a draft.
Draft plans are never automatically approved, activated, published, or finalized.

## Analysis verification

`POST /api/analysis/:id/confirm`

Requires authentication and a validated reviewed extraction body:

```json
{
  "extraction": {
    "medications": [],
    "findings": [],
    "tests": [],
    "follow_up": [],
    "warnings": [],
    "patient_summary": "No document-derived medical information is available.",
    "uncertainty_notes": []
  }
}
```

The operation is owner-scoped and persists the verified care plan.

### Human verification review

- `GET /api/analysis/:id/verified-care-plan` — current owner-scoped verified care plan.
- `GET /api/analysis/:id/review` — authenticated document-owner review payload.
- `PUT /api/analysis/:id/review` — validate and save owner edits to the
  document draft. The strict Phase 7 schema and source-support checks are
  applied before persistence.
- `GET /api/analysis/:id/versions` — owner-scoped finalized version history.
- `GET /api/analysis/:documentId/verified-care-plan/versions` — owner-scoped verified plan history with current-version metadata.
- `GET /api/analysis/:id/audit` — owner-scoped verification and review events.
- `GET /api/analysis/:documentId/verified-care-plan/history` — owner-scoped audit/review timeline.

Confirmation creates a new immutable version in
`verified_care_plan_versions`; older versions are retained and only the newest
version is marked current. Audit metadata contains identifiers and safe action
context only, never raw document text, credentials, tokens, or provider
secrets.

### Clinician review

- `POST /api/analysis/:id/clinician-review` — an owner submits a verified plan
  to a selected doctor account (`clinician_id`).
- `GET /api/analysis/clinician/reviews` — doctor-role users see only reviews
  assigned to their account.
- `PATCH /api/analysis/clinician/reviews/:reviewId` — assigned doctors can set
  `approved`, `rejected`, or `changes_requested`, with an optional note.

Clinician actions require a signed JWT with the `doctor` role and an assigned
review row. Approval does not remove the medical disclaimer or convert AI
output into a diagnosis.

## Medication management

All medication endpoints require authentication and return only records owned
by the authenticated user.

- `GET /api/medications` — returns medication schedules, today's doses,
  upcoming and due doses, recent missed doses, and adherence analytics.
- `POST /api/medications` — creates a daily medication schedule. The request
  requires `name` and a non-empty `dose_times` array of `HH:MM` values.
  Optional fields include `dosage`, `dosage_unit`, `start_date`, `end_date`,
  `instructions`, `notes`, and `grace_period_minutes` (0–1440).
- `POST /api/medications/:id/taken` — records the owner’s due scheduled dose
  as taken. An optional `scheduled_at` timestamp identifies a particular dose.
  Repeating a taken request for the same dose safely returns the existing
  taken record.
- `POST /api/medications/:id/skipped` — records the owner’s due scheduled dose
  as skipped. An optional `scheduled_at` timestamp identifies a particular
  dose.

Schedules are currently daily. The backend creates per-dose history records
for active schedules in a 30-day upcoming window. A still-scheduled dose is
marked missed only after its medication’s configured grace period has elapsed.
Adherence is calculated from real stored history as:

```text
taken eligible doses / all eligible scheduled doses × 100
```

Eligible doses are scheduled at or before the current time; future doses are
not included. When no eligible doses exist, adherence is returned as `null`.

## Follow-up and medical-test tracking

All tracking endpoints require authentication and return only records owned by
the authenticated user. Dates use `YYYY-MM-DD`; times use `HH:MM` or
`HH:MM:SS`.

### Follow-ups

- `GET /api/follow-ups` — list owner-scoped follow-ups with per-status counts
  and a derived `overdue` flag. Optional filters: `status` (one of `pending`,
  `scheduled`, `completed`, `cancelled`, `missed`), `from`, and `to`.
- `POST /api/follow-ups` — create a follow-up. Requires `title`; optional
  fields are `description`, `provider_or_specialist`, `appointment_date`,
  `appointment_time`, `due_date`, and `status`.
- `GET /api/follow-ups/:id` — retrieve one owned follow-up.
- `PATCH /api/follow-ups/:id` — update any subset of the fields above. Setting a
  terminal status stamps its timestamp; reopening clears it.
- `POST /api/follow-ups/:id/complete` — mark an owned follow-up `completed`.
  Repeating the action returns the existing record with `already_completed: true`.
- `DELETE /api/follow-ups/:id` — delete an owned follow-up.
- `GET /api/follow-ups/reminders/upcoming` — active follow-ups dated within the
  window (`days`, 1–90, default 14).

### Medical tests

- `GET /api/medical-tests` — list owner-scoped tests with per-status counts and
  a derived `overdue` flag. Optional filters: `status` (one of `pending`,
  `scheduled`, `completed`, `cancelled`), `from`, and `to`.
- `POST /api/medical-tests` — create a test. Requires `test_name`; optional
  fields are `instructions`, `scheduled_date`, `result_summary`, and `status`.
- `GET /api/medical-tests/:id` — retrieve one owned test.
- `PATCH /api/medical-tests/:id` — update any subset of the fields above.
- `POST /api/medical-tests/:id/complete` — mark an owned test `completed`, with
  an optional `result_summary`. The scheduled date is preserved and no result is
  invented; repeating the action returns `already_completed: true`.
- `DELETE /api/medical-tests/:id` — delete an owned test.
- `GET /api/medical-tests/reminders/upcoming` — active tests dated within the
  window (`days`, 1–90, default 14).

### Combined reminders

- `GET /api/reminders/upcoming` — one owner-scoped feed of active follow-ups
  (appointment date, falling back to due date) and active medical tests
  (scheduled date) within the window (`days`, 1–90, default 14), ordered by date.

Completed, cancelled, and missed records never appear in reminder responses.
Status lifecycles are enforced on write: `completed` requires `completed_at` and
`cancelled` requires `cancelled_at`, both stamped by the backend. Records
created from a verified care plan carry a fingerprint unique per owner, so
re-confirming a document does not duplicate task records and never overwrites an
owner's status or result changes. Follow-ups and tests with no determinable date
remain undated rather than receiving an invented date.

## AI structured extraction and draft care plans

The structured extraction endpoint reuses the completed-document flow:

`GET /api/documents/:id/extract`

It validates the provider response, preserves the anti-hallucination checks,
and atomically upserts `draft_care_plans` with structured medication and
follow-up records. The migration
`backend/database/migrations/20260916_create_draft_care_plans.sql` creates the
draft table, JSONB record collections, owner/document foreign keys, draft-only
status constraint, and owner/update index. The existing
`verified_care_plans` workflow remains separate and requires explicit human
confirmation.

Structured medication records validate dosage, frequency, duration, and route
when those fields are present. Dosage values use a numeric amount and supported
unit, frequency and duration use supported textual formats, and route uses the
supported route set. Structured follow-up records validate ISO dates, ISO
date-times, or explicit relative timeframes and allow only supported statuses.
Structured test records validate the test name, optional result/value, optional
status, and source text. Unexpected fields, malformed values, over-limit values,
and facts not supported by the document source are rejected safely. Missing
fields remain null or absent and are never inferred.

## Database setup

For local development, copy `backend/.env.example` to `backend/.env`, configure PostgreSQL, and apply `backend/database/schema.sql` followed by the SQL files in `backend/database/migrations/` in filename order.

Docker Compose applies the schema and migrations automatically on first initialization of its PostgreSQL volume.
