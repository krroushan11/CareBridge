# CareBridge AI - Phase 9: Verified Care Plan

## Phase 9 Overview

Phase 9 finalizes document-derived, owner-reviewed information as a verified care plan. A verified plan is stored per medical document, retains confirmation history, records verification activity, and converts confirmed medication and follow-up data into owner-scoped tracker records.

AI-extracted information remains informational. Confirmation does not make it a diagnosis or professional medical advice.

## Objectives

- Persist a verified care plan for an authenticated document owner.
- Validate reviewed structured extraction data before persistence.
- Support confirmation and re-confirmation with retained versions.
- Provide owner-scoped retrieval of the current plan, versions, and audit history.
- Convert confirmed medication and follow-up data into tracker records.

## Verified Care Plan Workflow

```text
Completed document and reviewed extraction
  → structured extraction validation
  → owner-scoped confirmation transaction
  → verified care-plan upsert
  → current version creation and audit event
  → medication and follow-up tracker synchronization
```

The confirmation transaction verifies the document belongs to the authenticated user, upserts `verified_care_plans`, creates the next version, records a confirmation event, and synchronizes tracker records.

## Reviewed Extraction Validation

Confirmation uses the existing structured extraction validation before database persistence. The reviewed extraction must satisfy the strict schema and bounded item rules; invalid data, including missing required fields or over-limit collections, is rejected before persistence. When a document has extracted text, source-support validation is also applied to the reviewed data.

## Current Verified Care Plan Retrieval

`GET /api/analysis/:id/verified-care-plan` returns the authenticated owner’s verified plan for a document. The response includes the verified extraction, disclaimer, confirmation and update timestamps, current-version metadata, and the latest clinician-review status when one exists.

## Version History

`verified_care_plan_versions` stores the plan, document, owner, version number, extraction, disclaimer, confirmation time, and current-version flag. Owner-scoped version endpoints return the retained versions in version-number order.

## Audit History

`verification_audit_events` records safe verification lifecycle metadata for a user and document. The owner-scoped history endpoint returns events such as `confirmed` and `reconfirmed` without raw OCR text, private storage keys, passwords, tokens, or credentials.

## Re-confirmation Behavior

Re-confirmation updates the existing verified plan only when it belongs to the confirming user. It retains prior version rows, clears the former `is_current` version, creates the next sequential current version, and records a re-confirmation audit event. The operation runs in a database transaction.

## Medication and Follow-up Trackers

Phase 9 adds owner-scoped conversion of confirmed plan data into:

- `medication_tracker_records`, derived from verified `medications` entries.
- `follow_up_tracker_records`, derived from verified `follow_up` entries.

On every confirmation or re-confirmation, existing tracker records for the verified care plan are deleted before the converted set is inserted. This keeps the trackers aligned with the latest verified extraction and prevents duplicate records. Tracker records are not created from unverified extraction data.

## Clinical Review / Approval Workflow

The analysis routes support an authenticated owner submitting a verified plan to a selected doctor-role clinician. Doctor-role users can list assigned reviews and update their assigned review to `approved`, `rejected`, or `changes_requested`. Clinician actions retain the medical disclaimer and do not convert AI output into a diagnosis.

## API Endpoints

All endpoints are mounted under `/api/analysis` and require JWT authentication. Clinician queue and update routes additionally require the `doctor` role.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/:id/confirm` | Confirm reviewed extraction data and persist/update the owner’s verified care plan. |
| `GET` | `/:id/verified-care-plan` | Retrieve the owner’s current verified care plan. |
| `GET` | `/:documentId/verified-care-plan/versions` | Retrieve owner-scoped verified-plan versions. |
| `GET` | `/:documentId/verified-care-plan/history` | Retrieve owner-scoped verification audit history. |
| `GET` | `/:id/review` | Retrieve owner-scoped review data. |
| `PUT` | `/:id/review` | Validate and save owner review edits to the draft plan. |
| `GET` | `/:id/versions` | Retrieve owner-scoped finalized version history. |
| `GET` | `/:id/audit` | Retrieve owner-scoped audit events. |
| `POST` | `/:id/clinician-review` | Submit a verified plan to a selected doctor-role clinician. |
| `GET` | `/clinician/reviews` | List reviews assigned to the authenticated doctor. |
| `PATCH` | `/clinician/reviews/:reviewId` | Update an assigned clinician review. |

## Database Changes

Phase 9 tracker migration:

```text
backend/database/migrations/20260918_phase9_verified_care_plan_trackers.sql
```

It creates `medication_tracker_records` and `follow_up_tracker_records`, each with foreign keys to the owner, verified care plan, and medical document, plus owner/document indexes and duplicate-prevention uniqueness constraints.

Phase 9 also uses the verified-plan, version-history, audit-history, draft-plan, and clinician-review tables established by:

- `20260912_create_verified_care_plans.sql`
- `20260916_create_draft_care_plans.sql`
- `20260917_phase8_verification_history.sql`

## Authentication and Authorization

- Protected analysis routes use JWT authentication through `authenticateToken`.
- Confirmation selects and persists data using both document ID and authenticated user ID.
- Current-plan retrieval, version history, and audit history are owner-scoped by user and document.
- Cross-user confirmation returns a not-found response rather than exposing another user’s document.
- Doctor-only routes require `requireRole("doctor")`; clinician updates are scoped to the assigned clinician.
- Confirmation responses do not include raw document text or private storage references.

## Tests and Validation

Focused Phase 9 coverage is in `backend/test/analysisVerification.test.ts`.

The current focused suite contains 10 tests covering owner confirmation and persistence, unauthenticated and cross-user rejection, invalid and over-limit reviewed extraction rejection before persistence, protection of raw/private document references, current-plan retrieval, version retrieval, audit retrieval, and idempotent medication/follow-up tracker synchronization.

```text
npx.cmd tsc --noEmit
node --import tsx --test --test-force-exit test/analysisVerification.test.ts
```

## Phase 9 Files

- `backend/database/migrations/20260918_phase9_verified_care_plan_trackers.sql`
- `backend/database/schema.sql`
- `backend/src/controllers/analysisController.ts`
- `backend/src/routes/analysisRoutes.ts`
- `backend/test/analysisVerification.test.ts`
- `docs/api.md`
- `docs/development-roadmap.md`
- `PHASE9_FINAL_REPORT.md`

## Known Limitations

- Tracker records represent verified document-derived medication and follow-up information; they do not provide medication scheduling, dose reminders, or adherence tracking.
- Clinician submission uses an owner-selected clinician account ID; a broader care-team relationship model is not part of this phase.
- Existing deployments must apply timestamped migrations to an already-initialized PostgreSQL database.
