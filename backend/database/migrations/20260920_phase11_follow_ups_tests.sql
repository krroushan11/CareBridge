-- Phase 11: Follow-up and medical-test persistent tracking.
-- Owner-scoped task records with structured appointment dates, controlled status
-- lifecycles, optional document traceability, and duplicate-protection fingerprints.
-- The migration is additive and idempotent.

CREATE TABLE IF NOT EXISTS follow_ups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID REFERENCES medical_documents(id) ON DELETE SET NULL,
    verified_care_plan_id UUID REFERENCES verified_care_plans(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    provider_or_specialist VARCHAR(255),
    appointment_date DATE,
    appointment_time TIME,
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled', 'missed')),
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    source_text TEXT,
    record_fingerprint VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed')
    ),
    CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL)
        OR (status <> 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_owner_status_date
    ON follow_ups (user_id, status, COALESCE(appointment_date, due_date));

CREATE INDEX IF NOT EXISTS idx_follow_ups_owner_created
    ON follow_ups (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_ups_document
    ON follow_ups (document_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_follow_ups_owner_fingerprint
    ON follow_ups (user_id, record_fingerprint)
    WHERE record_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS medical_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID REFERENCES medical_documents(id) ON DELETE SET NULL,
    verified_care_plan_id UUID REFERENCES verified_care_plans(id) ON DELETE CASCADE,
    test_name VARCHAR(255) NOT NULL,
    instructions TEXT,
    scheduled_date DATE,
    result_summary VARCHAR(500),
    result_document_id UUID REFERENCES medical_documents(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    source_text TEXT,
    record_fingerprint VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed')
    ),
    CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL)
        OR (status <> 'cancelled')
    ),
    CHECK (result_document_id IS NULL OR result_document_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_medical_tests_owner_status_date
    ON medical_tests (user_id, status, scheduled_date);

CREATE INDEX IF NOT EXISTS idx_medical_tests_owner_created
    ON medical_tests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_medical_tests_document
    ON medical_tests (document_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_medical_tests_owner_fingerprint
    ON medical_tests (user_id, record_fingerprint)
    WHERE record_fingerprint IS NOT NULL;
