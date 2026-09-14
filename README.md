# CareBridge AI

## Phase 6 - AI Structured Extraction

**Status: COMPLETE**

Phase 6 adds safe, validated AI structured extraction for completed medical
documents and automatically persists the result as an owner-scoped DRAFT
care plan.

## Objective

Convert document-derived text into structured, reviewable medical information
without inventing facts, weakening authentication, or bypassing document
ownership checks. Draft care plans remain unapproved until a separate explicit
review and confirmation step.

## AI Structured Extraction

The existing document extraction flow produces one validated JSON object with:

- `medications`
- `findings`
- `tests`
- `follow_up`
- `warnings`
- `patient_summary`
- `uncertainty_notes`

The implementation supports:

- Medicine extraction.
- Findings extraction.
- Tests extraction.
- Follow-up extraction.
- Strict structured JSON output.
- OpenAI-compatible provider adapter.
- Configurable provider URL through `AI_BASE_URL`.
- Configurable model through `AI_MODEL`.
- Environment-based API key through `AI_API_KEY`.
- Structured JSON request format with a strict response schema.
- Safe provider error handling.
- Malformed-response validation and rejection.
- Completed-processing requirement before AI extraction.
- Document ownership checks on every extraction request.

Provider failures and malformed responses return safe application errors without
exposing API keys, provider responses, raw document contents, or internal
implementation details.

## Structured Records

### Medication Records

Medication entries can preserve only information explicitly returned by the AI
provider, including:

- Name
- Dosage
- Frequency
- Route
- Duration
- Instructions
- Source/reference text

### Follow-Up Records

Follow-up entries can preserve only information explicitly returned by the AI
provider, including:

- Follow-up type or reason
- Recommended date or timeframe
- Instructions
- Provider or specialist
- Source/reference text

Missing fields remain unavailable. The service does not infer medication,
dosage, diagnosis, treatment, provider, or follow-up information.

## Automatic Draft Care-Plan Persistence

After successful extraction for an authenticated user's completed document, the
system creates or updates one owner-scoped DRAFT care plan for that document.
The draft stores:

- The validated structured extraction.
- Structured medication records.
- Structured follow-up records.
- The explicit `draft` status.

Persistence is idempotent for repeated extraction requests because each
document has at most one draft care plan. The database operation checks both
document ownership and `processing_status = 'completed'`. Draft care plans are
never automatically approved, activated, published, or finalized.

Empty extraction results produce empty record collections and do not fabricate
medical data. Failed or malformed AI responses do not create or update a
draft.

## API

### Structured Document Extraction

```http
GET /api/documents/:id/extract
```

Requirements and behavior:

- Requires JWT authentication.
- Accepts only a document owned by the authenticated user.
- Requires document processing to be complete.
- Returns validated structured extraction data and the persisted DRAFT care
  plan metadata.
- Does not expose raw extracted text, storage keys, filesystem paths, API keys,
  or provider error details.

### Explicit Reviewed Confirmation

```http
POST /api/analysis/:id/confirm
```

This existing owner-scoped endpoint remains a separate explicit confirmation
workflow. AI extraction creates only a DRAFT care plan; it does not confirm or
publish a care plan automatically.

## Database and Migration Changes

Phase 6 adds the PostgreSQL migration:

```text
backend/database/migrations/20260916_create_draft_care_plans.sql
```

The migration creates `draft_care_plans` with:

- UUID primary key.
- Unique document reference to prevent duplicate drafts.
- Foreign keys to the document and owner.
- Draft-only status constraint.
- JSONB medication records.
- JSONB follow-up records.
- Validated extraction JSONB.
- Creation and update timestamps.
- Owner/update index.

The canonical database schema representation is updated accordingly.

## Security and Ownership

- JWT authentication is required for extraction and confirmation operations.
- Every document query is scoped to the authenticated owner.
- Extraction requires a completed, owner-owned document.
- Draft care plans retain both document and user ownership references.
- UUID document identifiers are used by the document API.
- AI output is schema-validated before persistence.
- Anti-hallucination checks require extracted facts to be supported by source
  text.
- The provider is instructed not to invent medicines, dosages, diagnoses,
  results, dates, or instructions.
- Sensitive document content and provider credentials are not returned in API
  responses or ordinary error messages.
- Existing authentication, RBAC, and verified-care-plan behavior remains
  unchanged.

## Validation and Test Results

Phase 6 verification passed:

- Backend TypeScript build.
- Structured medication persistence tests.
- Structured follow-up persistence tests.
- Automatic DRAFT care-plan creation tests.
- Idempotent repeated-extraction persistence tests.
- Empty-extraction safety tests.
- Document-owner isolation tests.
- Authentication and RBAC regression tests.
- Failed and malformed AI response safety tests.
- Incomplete/unprocessed document rejection tests.
- Transactional/partial-persistence safety coverage.
- Existing document management and extraction tests.
- Existing analysis/verification regression tests.
- Existing reset authorization regression tests.
- `git diff --check`.
