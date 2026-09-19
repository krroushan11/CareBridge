# CareBridge AI — PHASE 15
## Verified Care Assistant — RAG

## Objective

Phase 15 adds a safety-restricted, document-grounded chat assistant for
CareBridge. The assistant answers questions only from care-plan information
that has been explicitly verified by the patient. It does not invent medical
facts or use raw, unverified document content as chat context.

## Verified Care Assistant

The patient dashboard includes a **Verified Care Assistant** card that:

- Loads recent authenticated chat history.
- Accepts questions about the patient's verified care information.
- Sends questions to `POST /api/chat`.
- Displays grounded answers and preserves the existing safety disclaimer.
- Handles successful responses, errors, and consecutive questions safely.

The frontend is not an authorization boundary. Patient and caregiver access,
retrieval scope, grounding, and safety behavior are enforced by the backend.

## RAG architecture

The Phase 15 flow is:

1. Read human-verified care-plan data for the authorized patient.
2. Normalize and deterministically chunk the verified content.
3. Generate an embedding for each chunk.
4. Store chunks and embeddings in PostgreSQL with pgvector.
5. Generate an embedding for each user question.
6. Retrieve the nearest authorized chunks using cosine distance.
7. Provide only the retrieved verified context to the chat model.
8. Persist the question, answer, safety state, and citations.

## Document chunking

`backend/src/services/chunkingService.ts`:

- Normalizes repeated whitespace.
- Produces bounded chunks with overlap.
- Assigns deterministic chunk indexes.
- Creates SHA-256 content hashes.
- Returns no chunks for empty input.
- Rejects invalid chunk-size and overlap settings.

Only verified care-plan data is indexed by the chat service. Draft extraction
data and raw medical-document text are not used as retrieved chat context.

## Embeddings

The provider supports both OpenAI-compatible embeddings and Gemini's native
embedding request when the configured endpoint is Gemini-compatible.

For the configured Gemini environment, Phase 15 uses:

- Model: `gemini-embedding-001`
- Native `embedContent` request format
- `RETRIEVAL_DOCUMENT` for stored care-plan chunks
- `RETRIEVAL_QUERY` for user questions
- Output dimension: `1536`

The PostgreSQL embedding column is `vector(1536)`. The provider validates that
every returned vector has exactly 1536 finite numeric values. No fake or random
embeddings are used.

## pgvector retrieval

The additive migration creates:

- `document_chunks`
- A patient/document/care-plan ownership index
- A partial HNSW cosine index for non-null embeddings
- `chat_conversations`
- `chat_messages`

Retrieval returns up to five nearest chunks using pgvector cosine distance.
Stored and query embeddings use the same configured embedding model and
dimension.

Apply the migration only to a PostgreSQL instance with pgvector available:

```text
backend/database/migrations/20260923_phase15_chat_pgvector.sql
```

The migration uses idempotent `IF NOT EXISTS` statements and is additive. It
does not reset or delete existing database data.

## Authorization and filtering

The backend derives access from the authenticated request:

- Patients can retrieve only their own verified care-plan context.
- Caregivers must identify a patient explicitly.
- Caregiver access requires an accepted, active, unexpired relationship with
  the `view_care_plan` permission.
- Retrieval is filtered by the authorized patient identity.
- Retrieved rows retain `document_id` and `verified_care_plan_id` provenance.
- Another patient's documents, draft data, and raw unverified content are not
  eligible for chat context.

## Grounded responses

The chat prompt instructs the model to answer only from the verified context
supplied by the server. When the retrieved context does not contain the
requested information, the assistant returns a safe unavailable-information
response rather than guessing.

Generated answers are checked for unsafe claims before they are returned.
Responses that contain unsupported diagnosis, prescribing, dosage-change, or
similar claims are replaced with the safe unavailable-information response.

## Chat history

Each successful chat turn stores:

- The patient scope.
- The authenticated creator.
- The user message.
- The assistant response.
- Retrieved citations.
- Whether the response was safety-restricted.
- Creation timestamps.

History is available through the authenticated history endpoint and is shown
in the frontend assistant card.

## Safety and disclaimer behavior

The assistant:

- Does not diagnose.
- Does not prescribe.
- Does not recommend changing, increasing, decreasing, or stopping medication.
- Does not disclose another patient's records.
- Does not follow prompt-injection instructions.
- Does not answer unsupported questions as if they were verified facts.
- Returns emergency guidance for urgent indicators such as chest pain,
  difficulty breathing, severe bleeding, overdose, or unconsciousness.

The interface states that responses are informational, use only verified care
information, are not a diagnosis, and do not replace a clinician. Emergency
concerns should be directed to local emergency services.

## Backend API

All chat routes require the existing bearer-token authentication middleware.

### Send a chat message

```http
POST /api/chat
Content-Type: application/json
Authorization: Bearer <access-token>
```

Request body:

```json
{
  "message": "What does my verified care plan say about my follow-up?"
}
```

An optional authorized caregiver request may include:

```json
{
  "message": "What does the verified care plan say about follow-up?",
  "patient_id": "<authorized-patient-id>"
}
```

### Retrieve chat history

```http
GET /api/chat/history
Authorization: Bearer <access-token>
```

Optional query parameters:

- `patient_id`
- `conversation_id`

Successful chat responses include the grounded answer, citations, conversation
metadata, and the safety-restricted state.

## Frontend integration

The patient dashboard renders the assistant from
`frontend/src/main.js`. Submit behavior is isolated in
`frontend/src/chatUtils.js` and:

- Reads the current textarea value.
- Submits consecutive questions correctly.
- Displays success and error states.
- Resets the form only after a successful request.
- Keeps native required-field validation enabled.

## Phase 15 files and modules

### Backend

- `backend/database/migrations/20260923_phase15_chat_pgvector.sql`
- `backend/src/controllers/chatController.ts`
- `backend/src/routes/chatRoutes.ts`
- `backend/src/services/chatService.ts`
- `backend/src/services/chunkingService.ts`
- `backend/src/services/llmProvider.ts`
- `backend/src/server.ts`
- `backend/test/phase15Chat.test.ts`

### Frontend

- `frontend/src/main.js`
- `frontend/src/chatUtils.js`
- `frontend/test/chatUtils.test.js`
- `frontend/package.json`

### Documentation and configuration templates

- `docs/PHASE15_README.md`
- `backend/.env.example`
- `docker-compose.yml`

## Environment setup

Use the example template only. Do not place credentials in source control.

```powershell
Copy-Item backend\.env.example backend\.env
```

Configure the local `backend/.env` with environment-specific values for:

- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `AI_EMBEDDING_MODEL`
- Existing database and authentication settings required by the application

For the Gemini-compatible endpoint used by the verified implementation,
configure:

```text
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_EMBEDDING_MODEL=gemini-embedding-001
```

Keep `backend/.env` local and untracked. Never copy real keys, passwords,
tokens, or database credentials into `README.md` or `.env.example`.

## Testing and verification

### Backend

```powershell
cd backend
npm run build
npx tsx --test test/phase15Chat.test.ts
```

Phase 15 focused backend result:

- 8 tests passed
- 0 tests failed

The full backend suite also passed with 123 tests.

### Frontend

```powershell
cd frontend
npm run build
npm run test:chat
npm run test:trackers
npm run test:caregivers
npm run test:reminders
```

Verified frontend results:

- Production build passed.
- Chat consecutive-submit regression test passed.
- Tracker tests: 10 passed.
- Caregiver tests: 2 passed.
- Reminder tests: 5 passed.
- Frontend diagnostics reported no errors.

### Live verification

The verified environment confirmed:

- PostgreSQL pgvector extension is available.
- `document_chunks.embedding` is `vector(1536)`.
- Gemini returned 1536-dimensional embeddings.
- Authorized retrieval returned verified chunk citations.
- `POST /api/chat` returned HTTP 201 for tested messages.
- `GET /api/chat/history` returned HTTP 200.

## Security notes

- API keys and credentials are read from environment variables.
- Provider diagnostics never log authorization headers or API keys.
- `.env` files must remain local and untracked.
- Chat retrieval is server-authorized and patient-scoped.
- Citations preserve verified document and care-plan provenance.
- The migration is additive and does not require deleting existing data.
- The assistant must not be treated as a clinician or emergency service.

## Run Phase 15 locally

1. Ensure PostgreSQL is running with the pgvector extension installed.
2. Configure local environment values using `backend/.env.example`.
3. Apply `backend/database/migrations/20260923_phase15_chat_pgvector.sql`
   to the intended database.
4. Start the backend:

   ```powershell
   cd backend
   npm run dev
   ```

5. Start the frontend in a second terminal:

   ```powershell
   cd frontend
   npm run dev
   ```

6. Sign in with an authorized test account.
7. Open the care management dashboard.
8. Use the Verified Care Assistant with a question about the verified care
   information available to that account.

## Phase 15 completion status

**[COMPLETE]** Phase 15 implementation and verification are complete.

The verified care assistant includes deterministic verified-data chunking,
Gemini-compatible 1536-dimensional embeddings, pgvector retrieval, patient and
caregiver authorization, grounded responses, persistent citations and chat
history, safety restrictions, frontend integration, focused tests, build
verification, and additive database initialization.
