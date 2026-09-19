-- Phase 14: patient-scoped caregiver invitations, permissions, and access state.
CREATE TABLE IF NOT EXISTS caregiver_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caregiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_email VARCHAR(150) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(permissions) = 'array'),
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
    accepted_at TIMESTAMP,
    rejected_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (patient_id <> caregiver_id),
    CHECK ((status = 'accepted' AND accepted_at IS NOT NULL) OR status <> 'accepted'),
    CHECK ((status = 'rejected' AND rejected_at IS NOT NULL) OR status <> 'rejected'),
    CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR status <> 'revoked')
);

CREATE INDEX IF NOT EXISTS idx_caregiver_relationships_patient
    ON caregiver_relationships (patient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caregiver_relationships_caregiver
    ON caregiver_relationships (caregiver_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_caregiver_active_relationship
    ON caregiver_relationships (patient_id, caregiver_id)
    WHERE status IN ('pending', 'accepted');
