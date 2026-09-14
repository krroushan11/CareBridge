# CareBridge AI

## Phase 5 - PDF Text Extraction / OCR

**Status: COMPLETE**

Phase 5 provides asynchronous medical-document text extraction for native PDFs,
scanned PDFs, JPEG images, and PNG images. Processing is authenticated and
owner-scoped throughout the document lifecycle.

## Completed Features

- Native PDF text extraction.
- `pdf-parse` integration.
- OCR fallback when native PDF text is insufficient.
- PDF page rendering for OCR.
- Tesseract OCR.
- JPEG OCR.
- PNG OCR.
- OCR page limit.
- Whitespace normalization.
- Processing status tracking.
- Processing lifecycle:
  `uploaded` -> `processing` -> `completed` or `failed`.
- Processing method tracking with `pdf_text` and `ocr`.
- Configurable multilingual OCR.
- English OCR fallback when configured language data is unavailable.
- PostgreSQL-backed background processing queue.
- Concurrent-safe queue claiming.
- Stale processing recovery.
- Bounded retry policy with exponential backoff for transient failures.
- Dedicated owner-scoped processing status endpoint.

## API

### Processing Status

```http
GET /api/documents/:id/status
```

This authenticated endpoint returns safe processing metadata for a document
owned by the current user, including its ID, status, processing method,
attempt/retry information, safe error state, and relevant timestamps.

Document processing is asynchronous: uploads return after the document is
queued, while the background worker performs PDF extraction or OCR separately.
All document access and processing status queries are owner-scoped.

## Phase 5 Architecture

```text
Upload
  -> queued processing
  -> PDF text extraction / OCR
  -> processing status
  -> completed or failed
```

Native PDF text extraction is attempted first. PDFs that do not contain
sufficient readable text use rendered-page OCR, while JPEG and PNG documents
use OCR directly. The worker safely claims queued jobs, recovers stale
processing records, and applies bounded retries to eligible transient failures.

## Security

- JWT authentication protects document processing and status access.
- Database queries are scoped to the authenticated document owner.
- Document IDs are validated as UUIDs before database access.
- Supported file types and content signatures are validated before processing.
- Private document storage details and filesystem paths are never exposed.
- Processing errors are represented by safe status values rather than internal
  document or storage information.

## Validation and Testing

Phase 5 verification completed successfully:

- TypeScript check passed.
- Backend build passed.
- Document management and OCR tests passed.
- Multilingual OCR configuration test passed.
- Background queue completion test passed.
- Concurrent-safe queue claim test passed.
- Stale processing recovery test passed.
- Retry and permanent failure tests passed.
- Processing status and owner-isolation tests passed.
- Authentication/RBAC regression tests passed.
- Analysis/verification regression tests passed.
- Reset authorization regression tests passed.
- `git diff --check` passed.

## Next Phase

The next phase has not been defined in the current project roadmap.
