-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    reset_otp VARCHAR(255),
    reset_otp_expiry TIMESTAMP,
    reset_otp_verified BOOLEAN DEFAULT FALSE,
    reset_authorization_token_hash VARCHAR(64),
    reset_authorization_expiry TIMESTAMP,
    role VARCHAR(20) NOT NULL DEFAULT 'patient'
        CHECK (role IN ('patient', 'caregiver', 'doctor', 'admin')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI Conversations Table
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    patient_name VARCHAR(100) NOT NULL,
    doctor_name VARCHAR(100),
    appointment_date TIMESTAMP NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Medical Documents Table
CREATE TABLE IF NOT EXISTS medical_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(255) UNIQUE NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    processing_status VARCHAR(20) NOT NULL DEFAULT 'uploaded'
        CHECK (processing_status IN ('uploaded', 'processing', 'completed', 'failed')),
    processing_method VARCHAR(20)
        CHECK (processing_method IN ('pdf_text', 'ocr')),
    processing_error TEXT,
    processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
    next_retry_at TIMESTAMP,
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    extracted_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_documents_user_id_created_at
    ON medical_documents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_medical_documents_processing_queue
    ON medical_documents (processing_status, next_retry_at, created_at);

-- Human-verified care plans derived from owner-reviewed document extraction.
CREATE TABLE IF NOT EXISTS verified_care_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID UNIQUE NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified_extraction JSONB NOT NULL,
    disclaimer TEXT NOT NULL,
    confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verified_care_plans_user_id_confirmed_at
    ON verified_care_plans (user_id, confirmed_at DESC);

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
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (verified_care_plan_id, medication_name,
            COALESCE(dosage, ''), COALESCE(frequency, ''), COALESCE(route, ''), COALESCE(duration, ''))
);

CREATE INDEX IF NOT EXISTS idx_medication_tracker_records_owner
    ON medication_tracker_records (user_id, document_id, created_at DESC);

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
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (verified_care_plan_id, follow_up_type,
            COALESCE(scheduled_date, ''), COALESCE(status, ''))
);

CREATE INDEX IF NOT EXISTS idx_follow_up_tracker_records_owner
    ON follow_up_tracker_records (user_id, document_id, created_at DESC);

-- Phase 10 medication-management schedules and per-dose adherence history.
CREATE TABLE IF NOT EXISTS medications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    dosage_unit VARCHAR(30),
    frequency VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (frequency = 'daily'),
    dose_times JSONB NOT NULL CHECK (jsonb_typeof(dose_times) = 'array' AND jsonb_array_length(dose_times) > 0),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    instructions TEXT,
    notes TEXT,
    grace_period_minutes INTEGER NOT NULL DEFAULT 240 CHECK (grace_period_minutes BETWEEN 0 AND 1440),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_medications_owner_active
    ON medications (user_id, active, start_date DESC);

CREATE TABLE IF NOT EXISTS medication_doses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'taken', 'skipped', 'missed')),
    taken_at TIMESTAMP,
    skipped_at TIMESTAMP,
    missed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (medication_id, scheduled_at),
    CHECK (
        (status = 'scheduled' AND taken_at IS NULL AND skipped_at IS NULL AND missed_at IS NULL)
        OR (status = 'taken' AND taken_at IS NOT NULL AND skipped_at IS NULL AND missed_at IS NULL)
        OR (status = 'missed' AND taken_at IS NULL AND skipped_at IS NULL AND missed_at IS NOT NULL)
        OR (status = 'skipped' AND taken_at IS NULL AND skipped_at IS NOT NULL AND missed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_medication_doses_owner_schedule
    ON medication_doses (user_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_medication_doses_medication_schedule
    ON medication_doses (medication_id, scheduled_at DESC);

-- Automatically generated, unapproved care-plan drafts from structured extraction.
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

-- Phase 8 history tables are created by the timestamped migration so existing
-- installations can apply them without recreating the base schema.
