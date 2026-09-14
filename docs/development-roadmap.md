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

## Phase 1 — Document Intelligence Foundation
- [ ] Define processing lifecycle
- [ ] PDF text extraction
- [ ] Detect when OCR is needed
- [ ] OCR for supported scanned/image documents
- [ ] Normalize extracted text
- [ ] Store safe processing metadata/status
- [ ] Test success and failure cases

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

## Phase 5 — Frontend
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

## Working Rule
One milestone at a time: document requirement → implement → TypeScript/build check → tests → verify → record files/results → only then start the next milestone.

## Next Milestone
**Care relationships and clinician workflow.**
Do not grant caregiver or doctor access to patient resources until explicit,
owner-approved relationship records and access rules are designed and tested.
