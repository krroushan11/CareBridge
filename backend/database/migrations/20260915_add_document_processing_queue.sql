ALTER TABLE medical_documents
    ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (processing_attempts >= 0),
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_medical_documents_processing_queue
    ON medical_documents (processing_status, next_retry_at, created_at);
