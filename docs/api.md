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
