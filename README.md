# CareBridge AI - Phase 8
## Human Verification

**Status: ✅ IMPLEMENTED**

CareBridge AI Phase 8 adds a secure human-verification workflow for
document-derived AI extraction. AI output remains untrusted and informational
until the authenticated document owner reviews, optionally edits, validates,
and confirms it. Confirmed care-plan versions are retained, verification
actions are auditable, and owners can submit verified information to an
authorized doctor for review.

The existing JWT authentication, RBAC, document ownership checks, PDF/OCR
processing, AI extraction, and Phase 7 Zod/source-support validation remain in
place.

## Human Verification Workflow

The implemented workflow is:

```text
Completed document
        ↓
AI structured extraction
        ↓
Owner review and edit
        ↓
Strict schema and source-support validation
        ↓
Owner confirmation
        ↓
Verified care-plan version
        ↓
Optional clinician review
        ↓
Approved / rejected / changes requested
```

The UI clearly states that extracted information is informational only. It
does not present AI output as a diagnosis or as medical advice.

## Owner Verification

Verification is available only to the authenticated owner of the medical
document.

The owner can:

- View the extracted source document filename.
- Review medicines, findings, tests, follow-ups, warnings, uncertainty notes,
  and the patient summary.
- See the medical disclaimer before confirmation.
- Review source-support information when it is present in structured records.
- Edit supported structured extraction fields before finalization.
- Validate and save edits.
- Cancel or revert unsaved edits.
- Confirm the reviewed information as a verified care plan.

Unauthenticated users are rejected by JWT middleware. Requests for another
user's document are rejected by owner-scoped database queries.

## Editing Before Finalization

The review UI supports editing the structured data already supported by the
backend, including:

- Medication records and supported medication fields.
- Findings.
- Tests and supported result/status fields.
- Follow-ups and supported date, status, provider, and instruction fields.
- Warnings, uncertainty notes, and the patient summary.

Edits are sent through the same strict validation path used for structured
extraction:

- Zod schemas reject malformed values.
- Strict object schemas reject unexpected fields.
- Item counts and field lengths remain bounded.
- Medication dosage, frequency, duration, and route rules remain enforced.
- Follow-up date/timeframe and status rules remain enforced.
- Source-support checks reject unsupported medical facts.
- Missing information is not silently inferred or fabricated.

The interface distinguishes the original AI extraction from user-edited
content through the review/edit workflow and requires the user to inspect the
updated information before confirmation.

## Confirmation and Finalization

Confirmation validates the reviewed extraction before persistence. A successful
confirmation:

- Stores the verified extraction in `verified_care_plans`.
- Preserves the medical disclaimer.
- Records the confirmation timestamp.
- Creates a retained verification version.
- Marks the newly created version as current.
- Records a confirmation or re-confirmation audit event.

Confirmation does not convert AI output into a diagnosis or automatically
approve it as clinician medical advice.

## Version History

Phase 8 retains finalized verification versions instead of permanently
overwriting the previous version.

Each retained version includes:

- A version number.
- The verified structured extraction.
- The document and owner relationship.
- The medical disclaimer.
- Confirmation and creation timestamps.
- A current-version indicator.

Only the latest finalized version is marked current. Version history queries
are owner-scoped and cannot expose another user's medical information.

## Verification and Review Audit History

Human verification actions are recorded in `verification_audit_events`.
Recorded actions include:

- `reviewed`
- `edited`
- `confirmed`
- `reconfirmed`
- `review_submitted`
- `clinician_approved`
- `clinician_rejected`
- `clinician_changes_requested`

Audit records include the authenticated user, document, optional care-plan
relationship, action type, safe metadata, and timestamp. Audit metadata does
not store passwords, JWTs, API keys, provider credentials, raw document text,
or private storage paths.

## Clinician Review Workflow

A document owner can submit a verified care plan to a selected clinician by
providing the clinician account ID. The selected account must have the
existing `doctor` role.

Doctor-only functionality includes:

- A clinician review queue containing only reviews assigned to that doctor.
- Viewing the verified extraction and disclaimer for assigned reviews.
- Approving a review.
- Rejecting a review.
- Requesting changes.
- Adding an optional clinician note.

Clinician review stores:

- Review status.
- Patient/document relationship.
- Assigned clinician identity.
- Optional patient and clinician notes.
- Request and review timestamps.

Patients cannot perform doctor-only actions, arbitrary authenticated users
cannot act as clinicians, and clinician approval does not remove the medical
disclaimer or imply automatic diagnosis.

## Security and Ownership Protections

- JWT authentication is required for all protected verification endpoints.
- Document IDs and review IDs are validated as UUIDs where applicable.
- Owner-scoped queries protect documents, care plans, versions, and audit
  history from IDOR and cross-user access.
- Clinician queue access requires the signed JWT `doctor` role.
- Clinicians can update only review records assigned to their account.
- AI output is validated before it is returned or persisted.
- Phase 7 source-support and anti-fabrication checks are preserved.
- API responses do not expose raw OCR text, private upload storage keys, or
  provider credentials.
- Audit records store only safe metadata.

## Phase 8 API Endpoints

All endpoints below require authentication. The clinician queue and clinician
review update endpoint additionally require the `doctor` role.

```text
GET    /api/analysis/:id/review
PUT    /api/analysis/:id/review
POST   /api/analysis/:id/confirm
GET    /api/analysis/:id/versions
GET    /api/analysis/:id/audit

POST   /api/analysis/:id/clinician-review
GET    /api/analysis/clinician/reviews
PATCH  /api/analysis/clinician/reviews/:reviewId
```

The owner review endpoint returns the safe document identity, current draft or
verified extraction, disclaimer, and confirmation state. The edit endpoint
validates and saves owner edits to the draft care plan. The confirmation
endpoint preserves the existing confirmation behavior while creating a
version and audit record.

## Phase 8 Database Changes

Migration added:

```text
backend/database/migrations/20260917_phase8_verification_history.sql
```

The migration creates:

| Table | Purpose |
| --- | --- |
| `verified_care_plan_versions` | Retained finalized versions with version numbers and current-version tracking |
| `verification_audit_events` | Owner-scoped verification and clinician-review audit events |
| `clinician_reviews` | Assigned clinician review status, identities, notes, and timestamps |

The migration includes foreign keys, status and version constraints, current
version uniqueness, and indexes for owner, document, patient, clinician, and
status queries. Docker initialization mounts this migration as the Phase 8
database migration.

## Phase 8 Frontend

The Phase 8 frontend implementation is in:

```text
frontend/index.html
frontend/src/main.js
```

It provides:

- Authenticated sign-in and unauthenticated access protection.
- Owner document review screen.
- Structured extraction cards.
- Medical disclaimer and source-document context.
- Structured editing controls.
- Validation, loading, empty, success, and error states.
- Cancel/revert editing.
- Confirmation controls.
- Version history display.
- Audit/review history display.
- Owner clinician-submission form.
- Doctor clinician-review queue.
- Approve, reject, and request-changes actions.

The frontend uses the existing Vite setup and connects to the real backend
endpoints rather than mock-only data.

## Testing and Verification

The Phase 8 verification regression completed with:

- **Phase 8 regression verification: 6 assertions passed**
  - Owner confirmation succeeds.
  - Unauthenticated confirmation is rejected.
  - Non-owner confirmation is rejected.
  - Invalid extraction is rejected before persistence.
  - Over-limit extraction is rejected before persistence.
  - Sensitive document/storage information is not returned.
- **Backend production build:** passed.
- **Frontend production build:** passed.
- **`git diff --check`:** passed.

The existing repository does not define an `npm test` script or a frontend
automated test runner. The backend regression was run directly with the
repository's installed TypeScript test tooling.

## Known Limitations

- Frontend behavior is currently validated through the production build; no
  frontend automated test framework is configured in the repository.
- The backend test process can remain open because of the existing PostgreSQL
  pool lifecycle after test assertions complete.
- Clinician assignment currently uses an owner-selected doctor account ID.
  A broader organization, care-team, or relationship model is not part of
  Phase 8.
- Existing deployments with an already-initialized PostgreSQL volume must
  apply the Phase 8 migration explicitly; Docker initialization automatically
  applies it only when initialization scripts are run.

## Phase 8 Completion

The following Phase 8 requirements are implemented:

- [x] Complete User Verification UI
- [x] Edit Before Finalization UI
- [x] Version History
- [x] Review/Audit History
- [x] Clinician Review Workflow

Phase 9 and later phases are not marked complete.
