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

Uploads return after the database record is created with `uploaded` status. The built-in PostgreSQL-backed worker claims queued records outside the HTTP request, processes them asynchronously, and records `processing`, `completed`, or `failed`. Transient processing failures are retried up to three total attempts with bounded backoff. This worker runs in the backend process; multi-instance production deployments should run a dedicated worker process or use shared queue-worker orchestration.

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

## Database setup

For local development, copy `backend/.env.example` to `backend/.env`, configure PostgreSQL, and apply `backend/database/schema.sql` followed by the SQL files in `backend/database/migrations/` in filename order.

Docker Compose applies the schema and migrations automatically on first initialization of its PostgreSQL volume.
