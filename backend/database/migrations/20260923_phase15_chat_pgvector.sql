-- Phase 15: verified-context retrieval and persistent chat history.
-- Additive only: this migration does not alter or delete existing records.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    verified_care_plan_id UUID NOT NULL REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL CHECK (length(content) > 0),
    content_hash VARCHAR(64) NOT NULL,
    embedding vector(1536),
    embedding_model VARCHAR(120) NOT NULL DEFAULT 'gemini-embedding-001',
    metadata JSONB NOT NULL DEFAULT '{"verification_status":"verified"}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (verified_care_plan_id, chunk_index),
    UNIQUE (verified_care_plan_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_user_document_plan
    ON document_chunks (user_id, document_id, verified_care_plan_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON document_chunks USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_patient
    ON chat_conversations (patient_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (length(content) > 0),
    citations JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(citations) = 'array'),
    safety_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
    ON chat_messages (conversation_id, created_at);
