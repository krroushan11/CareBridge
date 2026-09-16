# CareBridge AI — Development Roadmap

## Current Status
- [x] Authentication
- [x] Role-based access control
- [x] Password reset with reset authorization
- [x] PostgreSQL integration
- [x] Medical-document database table
- [x] Authenticated document upload
- [x] Owner-scoped document listing
- [x] PDF/JPEG/PNG and file-size validation
- [x] Private document storage
- [x] Document-management tests
- [x] TypeScript validation
- [x] Database migration applied
- [x] Owner-scoped document download, rename, delete, and processing-status APIs
- [x] Asynchronous PostgreSQL-backed document processing worker
- [x] Bounded retry and stale-processing recovery
- [x] Native PDF text extraction with OCR fallback
- [x] Configurable multilingual OCR
- [x] Background extraction worker and owner-scoped processing status

## Phase 5 — PDF Text Extraction / OCR

Status: **COMPLETE**

- [x] Native PDF text extraction
- [x] PDF rendering for OCR fallback
- [x] Tesseract OCR for PDF, JPEG, and PNG documents
- [x] Configurable multilingual OCR with English fallback
- [x] OCR page limit and whitespace normalization
- [x] Processing method tracking (`pdf_text` or `ocr`)
- [x] Transaction-safe background queue claiming
- [x] Bounded retry and stale-job recovery
- [x] Dedicated owner-scoped processing status endpoint

## Phase 1 — Document Intelligence Foundation
- [x] Define processing lifecycle
- [x] PDF text extraction
- [x] Detect when OCR is needed
- [x] OCR for supported scanned/image documents
- [x] Normalize extracted text
- [x] Store safe processing metadata/status
- [x] Test success and failure cases

## Phase 2 — AI Information Extraction
- [ ] Define strict AI output schema
- [ ] Define allowed information categories
- [ ] Build AI extraction service
- [ ] Validate AI output
- [ ] Handle malformed/ambiguous output
- [ ] Add AI tests
- [ ] Prevent sensitive-data logging

## Phase 3 — Patient-Friendly Presentation
- [ ] Structured document-result response
- [ ] Plain-language explanation
- [ ] Clearly separate extracted facts from AI explanation
- [ ] Safety messaging
- [ ] Do not present AI as a replacement for qualified medical professionals

## Phase 4 — Tracking
- [ ] Document-processing status
- [ ] Track document-derived medicines/instructions
- [ ] Track tests/findings/follow-up information
- [ ] Document history
- [ ] User-facing progress/status

## Phase 6 — Frontend
- [ ] Connect frontend to backend
- [ ] Authentication
- [ ] Upload
- [ ] Processing/progress
- [ ] Result view
- [ ] History/tracking

## Phase 6 — Production
- [ ] Integration tests
- [ ] Security review
- [ ] Error-handling review
- [ ] Safe observability
- [ ] Deployment
- [ ] Monitoring
- [ ] Bug fixing and improvement

## Phase 7 — Schema Validation & AI Safety

Status: **[✓] IMPLEMENTED**

- [✓] Zod strict schema validation
- [✓] Required categories
- [✓] Data type validation
- [✓] Maximum item counts
- [✓] Field length restrictions
- [✓] Unexpected field rejection
- [✓] Source-support checks
- [✓] Empty-source safe behavior
- [✓] AI disclaimer
- [✓] No invented medicines, diagnoses, results, or dates
- [✓] Sensitive data protection in errors
- [✓] Structured medication dosage schema
- [✓] Medication frequency schema
- [✓] Medication duration schema
- [✓] Medication route schema
- [✓] Structured follow-up date validation
- [✓] Follow-up status validation
- [✓] Structured test information validation

## Working Rule
One milestone at a time: document requirement → implement → TypeScript/build check → tests → verify → record files/results → only then start the next milestone.

## Next Milestone
**Care relationships and clinician workflow.**
Do not grant caregiver or doctor access to patient resources until explicit,
owner-approved relationship records and access rules are designed and tested.

## Phase 8 - Human Verification

Status: **[✓] IMPLEMENTED**

- [✓] Complete User Verification UI
- [✓] Edit Before Finalization UI
- [✓] Version History
- [✓] Review/Audit History
- [✓] Clinician Review Workflow

The document owner reviews and edits validated extraction before confirmation.
Finalized versions are retained, review actions are owner-scoped in an audit
history, and clinician review is limited to doctor-role users explicitly
selected by the document owner. AI output remains informational and is never
automatically treated as medical advice or clinician approval.

## Phase 9 - Verified Care Plan

Status: **[✓] IMPLEMENTED**

- [✓] Retrieve verified care plan for the authenticated owner
- [✓] Persist version history and current-version tracking
- [✓] Persist audit/review history for confirmation and clinician actions
- [✓] Convert verified medication data into owner-scoped tracker records
- [✓] Convert verified follow-up data into owner-scoped tracker records
- [✓] Re-confirmation is idempotent and does not duplicate tracker records
- [✓] Finalization is transactional and owner-scoped
- [✓] API and schema updates match the verified-care-plan workflows

This milestone requires the verified plan, version history, audit history, and
tracker synchronization to remain owner-scoped and safe across re-confirmations.

## Phase 10 - Medication Management

Status: **[✓] IMPLEMENTED**

- [✓] Owner-scoped medication schedules and dose history
- [✓] Taken, skipped, and grace-period-based missed-dose tracking
- [✓] Stored-history adherence analytics without future-dose penalties
- [✓] Medication dashboard with browser notification opt-in while open
