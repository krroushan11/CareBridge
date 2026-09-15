CREATE TABLE IF NOT EXISTS verified_care_plan_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    verified_care_plan_id UUID NOT NULL REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    verified_extraction JSONB NOT NULL,
    disclaimer TEXT NOT NULL,
    confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (verified_care_plan_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_care_plan_versions_current
    ON verified_care_plan_versions (verified_care_plan_id)
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_verified_care_plan_versions_owner
    ON verified_care_plan_versions (user_id, document_id, version_number DESC);

CREATE TABLE IF NOT EXISTS verification_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    verified_care_plan_id UUID REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    action VARCHAR(40) NOT NULL CHECK (action IN (
        'reviewed', 'edited', 'confirmed', 'reconfirmed',
        'review_submitted', 'clinician_approved', 'clinician_rejected',
        'clinician_changes_requested'
    )),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verification_audit_events_owner
    ON verification_audit_events (user_id, document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clinician_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    verified_care_plan_id UUID NOT NULL REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clinician_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'changes_requested')),
    patient_note VARCHAR(1000),
    clinician_note VARCHAR(1000),
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    UNIQUE (document_id, clinician_user_id)
);

CREATE INDEX IF NOT EXISTS idx_clinician_reviews_clinician_status
    ON clinician_reviews (clinician_user_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinician_reviews_patient
    ON clinician_reviews (patient_user_id, requested_at DESC);
