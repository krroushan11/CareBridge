# Phase 15 — Verified-Context Care Chat

## Scope

Phase 15 adds a safety-restricted chat assistant that can answer questions
using only human-verified care-plan information. It is additive to the Phase
14 schema and does not reset or rewrite existing database data.

## Database migration

Apply
`backend/database/migrations/20260923_phase15_chat_pgvector.sql` after the
Phase 14 migration. It enables the PostgreSQL `vector` extension and adds:

- `document_chunks`, with deterministic chunk hashes and 1536-dimensional
  embeddings;
- `chat_conversations`, scoped to the patient whose verified context is used;
- `chat_messages`, including citations and safety-restriction state.

The migration uses `IF NOT EXISTS`, foreign keys, and additive indexes. The
database must support pgvector; otherwise the migration must be applied after
installing/enabling pgvector. No database reset is part of this phase.

## Chunking and retrieval

`backend/src/services/chunkingService.ts` normalizes whitespace and creates
stable, bounded chunks with overlap and SHA-256 content hashes. The chat
service indexes verified care plans only, skips already embedded chunks, and
retrieves up to five nearest chunks with pgvector cosine distance.

Retrieval is server-authorized:

- patients can retrieve their own verified context;
- caregivers must identify a patient through an accepted, unexpired Phase 14
  relationship with `view_care_plan`;
- draft extraction, raw documents, and another patient's context are excluded.

## Provider configuration

The existing OpenAI-compatible settings are reused:

- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `AI_EMBEDDING_MODEL` (defaults to `text-embedding-3-small`, 1536 dimensions)

Provider credentials are never logged. Without `AI_API_KEY`, chat requests
return a safe service-unavailable response rather than fabricated content.

## APIs

Authenticated routes:

- `POST /api/chat` with `{ "message": "...", "patient_id": "..."? }`
- `GET /api/chat/history` with optional `patient_id` and `conversation_id`

Every successful turn persists both the user question and assistant answer.
Responses include retrieved chunk citations. The assistant prompt forbids
diagnosis, prescribing, medication changes, invented facts, and unsupported
answers. Emergency-indicator questions receive a fixed emergency-safety
response without calling the provider.

## Frontend

The patient dashboard includes a minimal verified-care assistant card. It
displays recent persisted messages and submits authenticated questions. The
server remains the authorization and safety boundary; the frontend does not
decide what context is safe to disclose.

## Validation and limitations

Focused tests are in `backend/test/phase15Chat.test.ts` and cover deterministic
chunking, grounded provider use, and emergency restriction. Run:

```powershell
cd backend
npm run build
npx tsx --test test/phase15Chat.test.ts

cd ..\frontend
npm run build
```

Live pgvector availability and provider/API credentials are environment
requirements and cannot be verified by unit tests. A deployment must apply the
migration and configure a compatible embedding model before enabling production
chat.
