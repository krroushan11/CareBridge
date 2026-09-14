-- Forward-only RBAC migration for databases created before users.role existed.
-- Existing accounts receive the least-privileged supported baseline role.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(20);

UPDATE users
SET role = 'patient'
WHERE role IS NULL
   OR role NOT IN ('patient', 'caregiver', 'doctor', 'admin');

ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'patient',
    ALTER COLUMN role SET NOT NULL;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check,
    ADD CONSTRAINT users_role_check
        CHECK (role IN ('patient', 'caregiver', 'doctor', 'admin'));
