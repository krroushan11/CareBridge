# CareBridge AI

## Phase 4 - Medical Document Management

**Status: COMPLETE**

Phase 4 provides authenticated, owner-scoped medical document management with
private storage and asynchronous processing backed by PostgreSQL.

### Implemented capabilities

- Authenticated medical document upload.
- Owner-scoped document listing and database queries.
- Private UUID-based storage keys for uploaded files.
- PDF, JPEG, and PNG support.
- MIME type and filename-extension validation.
- File-signature validation for PDF, JPEG, and PNG content.
- 10 MB upload limit.
- Owner-scoped document download/view.
- Owner-scoped document rename and metadata update.
- Owner-scoped document deletion, including the private stored file.
- Owner-scoped processing status API.
- PostgreSQL-backed asynchronous processing queue.
- Processing lifecycle: `uploaded` -> `processing` -> `completed` or `failed`.
- Retry handling for transient processing failures with exponential backoff.
- Recovery of stale processing records after the processing timeout.

### Medical document API

All endpoints require authentication and enforce the authenticated owner's
user ID:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/documents/upload` | Upload one PDF, JPEG, or PNG document using the `document` multipart field. |
| `GET` | `/api/documents` | List the authenticated user's documents and safe processing metadata. |
| `GET` | `/api/documents/:id/download` | Download an owner-scoped private document. |
| `PATCH` | `/api/documents/:id` | Update the document's display filename. |
| `DELETE` | `/api/documents/:id` | Delete the document and its private stored file. |
| `GET` | `/api/documents/:id/status` | Retrieve processing status, timestamps, failure state, and retry metadata. |

Uploads return after the database record is created with `uploaded` status.
The backend worker then processes queued documents outside the HTTP request.
Transient failures are retried up to three total processing attempts with
bounded exponential backoff.

### Security considerations

- Every Phase 4 document endpoint requires authentication.
- Database reads, updates, deletes, and downloads are scoped to both document
  ID and authenticated user ID.
- Uploaded files are stored outside public web routes under generated UUID
  filenames.
- Client-provided MIME types and extensions must agree with the supported
  document types.
- File signatures are checked before a document is persisted.
- Download filenames are sanitized before being returned in response headers.
- Processing responses expose safe status metadata without private storage keys
  or extracted document content.

### Verification

Phase 4 verification completed successfully:

- Backend TypeScript check passed.
- Backend production build passed.
- Document management tests passed.
- Authentication and RBAC regression tests passed without changing Phase 3
  behavior.
- Analysis and verification tests passed.
- Reset authorization regression tests passed.
- The Phase 4 migration was applied and its required columns and queue index
  were verified in the development database.
- Live download, rename, delete, and status endpoints passed against the
  database.
- Asynchronous processing and retry behavior passed against the database.
