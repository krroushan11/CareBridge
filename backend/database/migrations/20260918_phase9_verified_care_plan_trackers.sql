CREATE TABLE IF NOT EXISTS medication_tracker_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified_care_plan_id UUID NOT NULL REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    route VARCHAR(50),
    duration VARCHAR(100),
    instructions TEXT,
    source_text TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medication_tracker_records_owner
    ON medication_tracker_records (user_id, document_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_medication_tracker_records_plan_signature
    ON medication_tracker_records (
        verified_care_plan_id,
        medication_name,
        COALESCE(dosage, ''),
        COALESCE(frequency, ''),
        COALESCE(route, ''),
        COALESCE(duration, '')
    );

CREATE TABLE IF NOT EXISTS follow_up_tracker_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified_care_plan_id UUID NOT NULL REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    follow_up_type VARCHAR(255) NOT NULL,
    scheduled_date VARCHAR(100),
    status VARCHAR(30),
    notes TEXT,
    source_text TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_follow_up_tracker_records_owner
    ON follow_up_tracker_records (user_id, document_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_up_tracker_records_plan_signature
    ON follow_up_tracker_records (
        verified_care_plan_id,
        follow_up_type,
        COALESCE(scheduled_date, ''),
        COALESCE(status, '')
    );
