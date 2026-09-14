CREATE TABLE IF NOT EXISTS draft_care_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID UNIQUE NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
    medication_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    follow_up_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    extraction JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_draft_care_plans_user_id_updated_at
    ON draft_care_plans (user_id, updated_at DESC);
