ALTER TABLE medical_documents
    ADD COLUMN IF NOT EXISTS extracted_text TEXT,
    ADD COLUMN IF NOT EXISTS processing_method VARCHAR(20)
        CHECK (processing_method IN ('pdf_text', 'ocr')),
    ADD COLUMN IF NOT EXISTS processing_error TEXT,
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMP;
