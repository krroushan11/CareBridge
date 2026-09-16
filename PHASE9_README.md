# Phase 9 – Verified Care Plan

## 1. Overview

Phase 9 adds a verified-care-plan workflow to CareBridge AI. It allows an authenticated document owner to confirm a reviewed structured extraction, persist it as the document's verified care plan, and access the resulting plan and its history. Confirmation also derives medication and follow-up tracker records from the verified data so those trackers reflect the latest confirmed plan.

## 2. Phase 9 Objectives

- Persist one verified care plan for each medical document.
- Preserve the owner-to-document relationship for all plan and history operations.
- Support initial confirmation and subsequent re-confirmation.
- Retain sequential verified-care-plan versions.
- Record verification audit events.
- Convert verified medication data into medication tracker records.
- Convert verified follow-up data into follow-up tracker records.

## 3. Implemented Features

- A confirmed reviewed extraction is stored in `verified_care_plans` through an owner-scoped upsert.
- Re-confirmation updates the verified plan, marks the preceding current version as non-current, and creates the next version.
- Verified plans can be retrieved with current-version metadata and the latest clinician review status, when available.
- Version history and audit history are available through owner-scoped queries.
- Confirmation creates an audit event with the version number and distinguishes initial confirmation from re-confirmation.
- Medication and follow-up values from the verified extraction are normalized into tracker records.
- Tracker synchronization removes the plan's existing tracker records before inserting the current set, so re-confirmation does not accumulate stale tracker entries.

## 4. Database

The feature is anchored to `medical_documents` and `users` through UUID foreign keys.

| Table | Phase 9 role | Important relationship |
| --- | --- | --- |
| `verified_care_plans` | Stores the current verified extraction, disclaimer, and confirmation timestamps. | One plan per document (`document_id` is unique); belongs to a user and medical document. |
| `verified_care_plan_versions` | Stores numbered snapshots of confirmed plan data. | Belongs to a verified plan, document, and user; only one version is marked current per plan. |
| `verification_audit_events` | Stores verification lifecycle events and metadata. | Owner- and document-scoped; optionally references the verified plan. |
| `medication_tracker_records` | Stores medication entries derived from verified extraction data. | References the owner, verified plan, and medical document. |
| `follow_up_tracker_records` | Stores follow-up entries derived from verified extraction data. | References the owner, verified plan, and medical document. |
| `draft_care_plans` | Supplies intermediate reviewed extraction data used by the broader verification workflow. | One draft per document; belongs to the document owner. |

Relevant migrations in the repository are:

- `backend/database/migrations/20260912_create_verified_care_plans.sql` — base verified-plan storage.
- `backend/database/migrations/20260917_phase8_verification_history.sql` — version, audit, and clinician-review history tables used by this workflow.
- `backend/database/migrations/20260918_phase9_verified_care_plan_trackers.sql` — Phase 9 medication and follow-up tracker tables and owner indexes.

## 5. API Endpoints

All endpoints below are mounted under `/api/analysis` and require JWT authentication through `authenticateToken`.

| Method | Endpoint | Purpose | Response purpose |
| --- | --- | --- | --- |
| `POST` | `/:id/confirm` | Validate and confirm a reviewed extraction for the authenticated owner’s document. | Returns confirmation status, plan/document IDs, verified care-plan data, disclaimer, timestamp, and version number. |
| `GET` | `/:id/verified-care-plan` | Retrieve the current verified care plan for an owner’s document. | Returns the verified plan with current-version and clinician-review metadata. |
| `GET` | `/:documentId/verified-care-plan/versions` | Retrieve an owner’s version history for a document. | Returns ordered verified-care-plan version records. |
| `GET` | `/:documentId/verified-care-plan/history` | Retrieve an owner’s verification audit history for a document. | Returns audit event records. |

The router also exposes owner-authenticated aliases for version and audit history at `/:id/versions` and `/:id/audit`, respectively.

## 6. Verification and Security

- Protected Phase 9 routes use JWT authentication; an unauthenticated confirmation request is rejected with `401`.
- Confirmation checks the reviewed extraction with the structured-extraction validator before opening persistence work. Invalid or over-limit data is rejected before database persistence.
- Confirmation selects the medical document with both its document ID and authenticated user ID. The verified-plan upsert is likewise owner-scoped.
- Current-plan retrieval, version-history retrieval, and audit-history retrieval filter by both document ID and authenticated user ID, preventing cross-user access through another document ID.
- Re-confirmation versions are created in a transaction: the previous current version is cleared before a new current version is inserted.
- Tracker synchronization deletes medication and follow-up records for the verified plan before inserting converted entries, making the tracker set idempotent for re-confirmation.
- The focused test verifies that confirmation responses do not include raw OCR text or private storage-reference fields. No credentials, tokens, or environment values are documented here.

## 7. Tests

The focused Phase 9 test file is `backend/test/analysisVerification.test.ts`. The current focused test run reports **10 passing tests**.

| Verified behavior | Coverage |
| --- | --- |
| Authenticated owner can confirm and persist reviewed care-plan data | Covered |
| Unauthenticated confirmation rejection | Covered |
| Cross-user confirmation rejection | Covered |
| Invalid reviewed extraction rejection before persistence | Covered |
| Over-limit reviewed extraction rejection before persistence | Covered |
| Confirmation response excludes raw/private document references | Covered |
| Current verified care-plan retrieval with version metadata | Covered |
| Version-history retrieval | Covered |
| Audit/review-history retrieval | Covered |
| Medication and follow-up tracker conversion on re-confirmation | Covered |

Validation commands used for the current Phase 9 state:

```text
npx.cmd tsc --noEmit
node --import tsx --test --test-force-exit test/analysisVerification.test.ts
```

## 8. Phase 9 Final Status

- [x] Verified care-plan persistence is implemented and tested.
- [x] Owner/document-scoped confirmation and retrieval are implemented and tested.
- [x] Confirmation and re-confirmation create sequential history versions.
- [x] Owner-scoped version and audit history endpoints are implemented and tested.
- [x] Medication and follow-up tracker conversion is implemented and tested.
- [x] Tracker synchronization is idempotent on re-confirmation.
- [x] TypeScript validation passes for the current Phase 9 state.

## 9. Files Changed

Important Phase 9 implementation files in the current repository include:

- `backend/src/controllers/analysisController.ts`
- `backend/src/routes/analysisRoutes.ts`
- `backend/database/schema.sql`
- `backend/database/migrations/20260912_create_verified_care_plans.sql`
- `backend/database/migrations/20260917_phase8_verification_history.sql`
- `backend/database/migrations/20260918_phase9_verified_care_plan_trackers.sql`
- `backend/test/analysisVerification.test.ts`
- `PHASE9_FINAL_REPORT.md`

## 10. How Phase 9 Works

```text
Medical document
  → AI extraction and reviewed extraction data
  → structured extraction validation
  → owner-scoped confirmation
  → verified care plan upsert
  → version and audit event creation
  → medication and follow-up tracker record synchronization
```

On re-confirmation, the verified plan is updated, a new current version is created, the prior current version is retained as history, and tracker records are replaced with records derived from the latest verified extraction.

## 11. Important Safety Note

CareBridge AI presents extracted medical information for review and verification; it does not present AI output as a diagnosis or as professional medical advice. Users and appropriate clinicians should review the information before relying on it for care decisions.

## 12. Next Phase

The next phase will be developed separately after reviewing the project roadmap.
