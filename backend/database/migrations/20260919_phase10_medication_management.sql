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
        OR (status = 'skipped' AND taken_at IS NULL AND skipped_at IS NOT NULL AND missed_at IS NULL)
        OR (status = 'missed' AND taken_at IS NULL AND skipped_at IS NULL AND missed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_medication_doses_owner_schedule
    ON medication_doses (user_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_medication_doses_medication_schedule
    ON medication_doses (medication_id, scheduled_at DESC);
